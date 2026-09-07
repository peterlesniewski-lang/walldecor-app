// Local test supervisor. Restart requests are private files, never HTTP endpoints.
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, watch, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import path from 'node:path'
import { validateInstallationCalendarE2eDatabase } from '../src/lib/installations/calendar-e2e-database'

const database = validateInstallationCalendarE2eDatabase(process.env)
if (!database || process.env.WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED !== 'true') throw new Error('Restartable server requires an owned isolated E2E database.')
const requestPath = path.join(database.directoryPath, 'restart-request')
const ackPath = path.join(database.directoryPath, 'restart-complete')
let child: ChildProcess | null = null
let stopping = false
let restarting = false
let lastRequest = ''

function isReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get('http://127.0.0.1:3000/login', { timeout: 2_000 }, (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.on('error', () => resolve(false))
    request.on('timeout', () => { request.destroy(); resolve(false) })
  })
}

function start() {
  child = spawn(process.execPath, ['--preserve-symlinks', 'node_modules/next/dist/bin/next', 'dev'], {
    cwd: process.cwd(), env: process.env, stdio: 'inherit', detached: true,
  })
  child.once('error', (error) => { console.error(error); process.exitCode = 1 })
  child.once('exit', (code) => {
    if (!stopping && !restarting) process.exit(code ?? 1)
  })
}

async function stopChild() {
  const current = child
  if (!current?.pid || current.exitCode !== null) return
  await new Promise<void>((resolve) => {
    current.once('exit', () => resolve())
    // Only terminate the process group created by this supervisor.
    process.kill(-current.pid!, 'SIGTERM')
  })
}

const watcher = watch(database.directoryPath, async (_event, filename) => {
  if (filename !== 'restart-request' || stopping || restarting) return
  let request: string
  try { request = readFileSync(requestPath, 'utf8').trim() } catch { return }
  if (!request || request === lastRequest) return
  restarting = true
  try {
    await stopChild()
    if (stopping) return
    start()
    console.log(`Restarted isolated test server (PID ${child?.pid}). Waiting for readiness.`)
    const deadline = Date.now() + 90_000
    let ready = false
    while (!stopping && Date.now() < deadline && child?.exitCode === null) {
      ready = await isReady()
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!ready) throw new Error('Restarted test server did not become ready.')
    lastRequest = request
    writeFileSync(ackPath, request, { mode: 0o600 })
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally { restarting = false }
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (stopping) return
  stopping = true
  watcher.close()
  await stopChild()
  process.exit(0)
})
start()
