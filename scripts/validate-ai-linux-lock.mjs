#!/usr/bin/env node
/**
 * Synthetic Linux flock deployment gate. No authentication or external provider.
 * The fixture replaces only the worker supervisor in disposable containers;
 * entrypoint.sh, runCodexJob, the npm launcher and native CLI are image originals.
 * An anchor keeps the namespace alive after SIGKILL of only the supervisor.
 * It never receives a lock FD. The provider shim closes its own FD after spawn.
 * Usage: node scripts/validate-ai-linux-lock.mjs --image <built-image>
 *        [--docker-host unix:///var/run/docker.sock]
 * Omitting --docker-host preserves the existing local Docker Desktop endpoint.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LOCAL_DOCKER = 'unix:///Users/piotr/.docker/run/docker.sock'
const PROOF_ROOT = '/runtime/proof'
const LOCK_PATH = '/oauth/.session.lock'
const ENTRYPOINT = '/opt/ai/worker/ai/entrypoint.sh'
const FIXTURE = '/fixture/gate.mjs'
const EXPECTED_VERSION = 'codex-cli 0.153.4'
const live = (process) => process.state !== 'Z' && process.state !== 'X'
const roleAlive = (processes, role) => processes.some((process) => process.role === role && live(process))

/** Evaluate observations, never infer success merely from source or exit 75. */
export function assessSessionCase(proof) {
  const failures = []
  const before = proof?.before ?? {}
  const killed = proof?.afterSupervisorKilled ?? {}
  const exited = proof?.afterDescendantExit ?? {}
  const processes = killed.processes ?? []
  if (proof?.version !== EXPECTED_VERSION || !proof?.platform?.startsWith('linux-')) failures.push('WRONG_CLI_OR_PLATFORM')
  if (before.contender?.exitCode !== 75 || !before.contender?.stderr?.includes('AI_SESSION_IN_USE')) failures.push('INITIAL_SESSION_NOT_EXCLUSIVE')
  if (killed.supervisorExit?.signal !== 'SIGKILL' || roleAlive(processes, 'supervisor')) failures.push('SUPERVISOR_NOT_KILLED')
  const launcher = processes.find((process) => process.role === 'npm-launcher' && live(process))
  const native = processes.find((process) => process.role === 'native-cli' && live(process))
  if (!launcher || !native || native.parentPid !== launcher.pid || !roleAlive(processes, 'anchor')) failures.push('REAL_CLI_NOT_ALIVE_AFTER_SUPERVISOR_KILL')
  if (![launcher, native].some((process) => process?.lockFds?.length)) failures.push('REAL_CLI_LOCK_NOT_RETAINED')
  if (processes.some((process) => ['anchor', 'shim'].includes(process.role) && process.lockFds?.length)) failures.push('FIXTURE_RETAINS_LOCK')
  if (killed.contender?.exitCode !== 75 || !killed.contender?.stderr?.includes('AI_SESSION_IN_USE')) failures.push('OVERLAPPING_SESSION_ENTERED')
  if (!before.inode || before.inode !== killed.inode || before.inode !== exited.inode) failures.push('LOCK_INODE_CHANGED')
  if (exited.cliExit?.code !== 0 || exited.cliExit?.signal !== null ||
      (exited.processes ?? []).some((process) => ['npm-launcher', 'native-cli', 'shim'].includes(process.role) && live(process))) failures.push('CLI_DID_NOT_EXIT_SUCCESSFULLY')
  if (exited.contender?.exitCode !== 0 || exited.contender?.entered !== true) failures.push('SESSION_NOT_RELEASED_AFTER_CLI_EXIT')
  if (proof?.provider?.inferenceStarted !== true || proof?.provider?.completed !== true || proof?.provider?.authorizationPresent !== false) failures.push('SYNTHETIC_INFERENCE_NOT_PROVEN')
  return { passed: failures.length === 0, failures }
}

/** Recompute both case assessments, including when reviewing saved evidence. */
export function assessSessionReport(positive, negative) {
  const positiveAssessment = assessSessionCase(positive)
  const negativeAssessment = assessSessionCase(negative)
  const negativeControlDetected = !negativeAssessment.passed && negativeAssessment.failures.length === 2 &&
    negativeAssessment.failures.includes('REAL_CLI_LOCK_NOT_RETAINED') && negativeAssessment.failures.includes('OVERLAPPING_SESSION_ENTERED') &&
    negative.before.contender.exitCode === 75 && negative.afterSupervisorKilled.contender.exitCode === 0 && roleAlive(negative.afterSupervisorKilled.processes, 'native-cli') && negative.afterDescendantExit.cliExit.code === 0
  return { passed: positiveAssessment.passed && negativeControlDetected, negativeControlDetected }
}

function jsonFile(name, value) {
  writeFileSync(`${PROOF_ROOT}/${name}.json`, JSON.stringify(value, null, 2), { mode: 0o600 })
}
function readJson(name) {
  try { return JSON.parse(readFileSync(`${PROOF_ROOT}/${name}.json`, 'utf8')) } catch { return null }
}
function inode(file) {
  const info = statSync(file)
  return `${info.dev}:${info.ino}`
}

/** Only /proc metadata and synthetic evidence, never auth contents or environment. */
function snapshot() {
  const lockInode = inode(LOCK_PATH)
  const supervisor = readJson('supervisor')
  const launch = readJson('inference-launch')
  const processes = []
  for (const entry of readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))) {
    try {
      const pid = Number(entry)
      const status = readFileSync(`/proc/${pid}/stat`, 'utf8').slice(readFileSync(`/proc/${pid}/stat`, 'utf8').lastIndexOf(')') + 2).split(' ')
      const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
      const executable = readlinkSync(`/proc/${pid}/exe`)
      const role = pid === 1 ? 'anchor' : pid === supervisor?.pid ? 'supervisor' : pid === launch?.shimPid ? 'shim' : pid === launch?.launcherPid ? 'npm-launcher' : /\/vendor\/[^/]+\/bin\/codex$/.test(executable) ? 'native-cli' : 'other'
      const lockFds = readdirSync(`/proc/${pid}/fd`).filter((fd) => {
        try { return inode(`/proc/${pid}/fd/${fd}`) === lockInode } catch { return false }
      }).map(Number)
      processes.push({ pid, parentPid: Number(status[1]), state: status[0], role, executable, command, lockFds })
    } catch { /* Processes may exit while their /proc entries are inspected. */ }
  }
  return { inode: lockInode, processes, supervisorExit: readJson('supervisor-exit'), cliExit: readJson('inference-exit'), launch, provider: readJson('provider'), version: readJson('runner-version')?.stdout?.trim(), platform: `${process.platform}-${process.arch}` }
}

async function command(binary, args, timeoutMs = 20_000, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`COMMAND_TIMEOUT:${binary} ${args[0]}`)) }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 4_000_000) child.kill('SIGKILL') })
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 200_000) child.kill('SIGKILL') })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal, stdout, stderr }) })
  })
}

async function supervisorMain() {
  if (process.env.LINUX_LOCK_GATE_CONTENDER === '1') {
    process.stdout.write(`${JSON.stringify({ entered: true, inode: inode(LOCK_PATH) })}\n`)
    return
  }
  const lock = statSync('/proc/self/fd/9')
  const expected = statSync(LOCK_PATH)
  if (lock.dev !== expected.dev || lock.ino !== expected.ino || !lock.isFile()) throw new Error('SESSION_LOCK_REQUIRED')
  jsonFile('supervisor', { pid: process.pid, lockFd: 9, inode: inode(LOCK_PATH) })
  const { runCodexJob } = await import('/opt/ai/src/lib/ai/codex-runner.ts')
  const { aiJobResultJsonSchema } = await import('/opt/ai/src/lib/ai/contracts.ts')
  try {
    const result = await runCodexJob({ kind: 'FINANCE_CHAT', prompt: 'SYNTHETIC LOCK FIXTURE ONLY', schema: aiJobResultJsonSchema('FINANCE_CHAT') }, {
      binary: '/fixture/codex-lock-shim.mjs', catalogPath: '/opt/ai/worker/ai/catalog.json',
      oauthHome: '/oauth', workRoot: '/runtime/jobs', sessionLockFd: 9, timeoutMs: 90_000,
    })
    jsonFile('runner-result', { succeeded: true, result })
  } catch (error) {
    jsonFile('runner-result', { succeeded: false, code: error?.code ?? 'ERROR' })
    process.exitCode = 1
  }
}

async function shimMain() {
  const config = readJson('config')
  if (!config) throw new Error('TEST_CONFIG_REQUIRED')
  const args = process.argv.slice(2)
  const isVersion = args.includes('--version')
  if (!isVersion) {
    const overrides = [
      'model_provider="linux_lock_fixture"', 'features.enable_request_compression=false',
      `model_providers.linux_lock_fixture={name="linux_lock_fixture",base_url="http://127.0.0.1:${config.port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false,request_max_retries=0,stream_max_retries=0}`,
    ].flatMap((value) => ['-c', value])
    if (args[0] !== 'exec') throw new Error('SYNTHETIC_EXEC_REQUIRED')
    args.splice(1, 0, ...overrides)
  }
  // Negative control differs ONLY in inherited FD. Immediately close our copy
  // after spawn, so this shim can never manufacture a positive lock result.
  const child = spawn('/usr/local/bin/codex', args, {
    env: process.env, cwd: process.cwd(), shell: false,
    stdio: config.dropInheritedFd ? [0, 'pipe', 'pipe'] : [0, 'pipe', 'pipe', 3],
  })
  closeSync(3)
  // Independently drain real CLI output after its supervisor has been killed.
  // Otherwise the dead parent's stdout pipe makes the CLI panic on EPIPE at
  // completion, which tests the pipe lifetime instead of natural lock release.
  let stdout = '', stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 1024 * 1024) child.kill('SIGKILL') })
  child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 64 * 1024) child.kill('SIGKILL') })
  process.stdout.on('error', () => {})
  process.stderr.on('error', () => {})
  if (!isVersion) jsonFile('inference-launch', { shimPid: process.pid, launcherPid: child.pid, shimClosedFd: 3, dropInheritedFd: config.dropInheritedFd, launcherPath: '/usr/local/bin/codex', launcherRealpath: readlinkSync('/usr/local/bin/codex') })
  child.once('error', () => { process.exitCode = 1 })
  child.once('close', (code, signal) => {
    jsonFile(isVersion ? 'runner-version' : 'inference-exit', { code, signal, stdout, stderr })
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    process.exitCode = code ?? 1
  })
}

async function anchorMain() {
  await mkdir(PROOF_ROOT, { recursive: true, mode: 0o700 })
  const version = await command('/usr/local/bin/codex', ['--version'])
  jsonFile('version', version)
  const provider = { inferenceStarted: false, authorizationPresent: false, completed: false, requests: [] }
  let pending
  let worker
  const result = { id: 'response_synthetic', object: 'response', status: 'completed', output: [{ type: 'message', id: 'msg_synthetic', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"answer":"SYNTHETIC LOCK FIXTURE ONLY"}', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
  const event = (response, value) => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/control/snapshot') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(snapshot()))
        return
      }
      if (request.url === '/control/kill-supervisor') {
        if (!worker?.pid || worker.exitCode !== null || worker.signalCode !== null) throw new Error('SUPERVISOR_NOT_RUNNING')
        worker.kill('SIGKILL')
        response.end('{"signal":"SIGKILL"}')
        return
      }
      if (request.url === '/control/release') {
        if (!pending) throw new Error('INFERENCE_NOT_PENDING')
        const item = result.output[0]
        event(pending, { type: 'response.output_item.added', output_index: 0, item })
        event(pending, { type: 'response.output_item.done', output_index: 0, item })
        event(pending, { type: 'response.completed', response: result })
        pending.end()
        pending = undefined
        provider.completed = true
        jsonFile('provider', provider)
        response.end('{"released":true}')
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/responses' || provider.requests.length) { response.writeHead(400); response.end(); return }
      let text = ''
      for await (const chunk of request) { text += chunk; if (text.length > 1024 * 1024) throw new Error('FIXTURE_REQUEST_TOO_BIG') }
      const body = JSON.parse(text)
      provider.authorizationPresent ||= 'authorization' in request.headers
      provider.requests.push({ method: request.method, path: request.url, model: body.model, tools: body.tools, body })
      provider.inferenceStarted = true
      jsonFile('provider', provider)
      pending = response
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      event(response, { type: 'response.created', response: { ...result, status: 'in_progress', output: [] } })
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: String(error.message) })) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  jsonFile('config', { port: server.address().port, dropInheritedFd: process.argv.includes('--drop-inherited-fd') })
  const imageFiles = [ENTRYPOINT, '/opt/ai/src/lib/ai/codex-runner.ts', '/opt/ai/node_modules/@openai/codex/bin/codex.js']
  jsonFile('image-files', imageFiles.map((file) => ({ path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })))
  worker = spawn(ENTRYPOINT, ['worker'], { env: process.env, shell: false, stdio: ['ignore', 'inherit', 'inherit'] })
  worker.once('close', (code, signal) => jsonFile('supervisor-exit', { code, signal }))
  worker.once('error', (error) => jsonFile('supervisor-error', { message: error.message }))
  setTimeout(() => { server.closeAllConnections(); server.close(); process.exit(2) }, 100_000).unref()
}

async function controlMain() {
  const config = readJson('config')
  if (!config) throw new Error('ANCHOR_NOT_READY')
  const response = await fetch(`http://127.0.0.1:${config.port}/control/${process.argv[3]}`, { signal: AbortSignal.timeout(5_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(text)
  process.stdout.write(text)
}

async function hostMain() {
  const args = process.argv.slice(2)
  const usage = 'USAGE: --image <already-built-local-image> [--docker-host <unix:///var/run/docker.sock or local Docker Desktop socket>]'
  const options = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!['--image', '--docker-host'].includes(name) || options.has(name) || !value || value.startsWith('--')) throw new Error(usage)
    options.set(name, value)
  }
  const image = options.get('--image')
  const dockerHost = options.get('--docker-host') ?? LOCAL_DOCKER
  if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(image) || ![LOCAL_DOCKER, 'unix:///var/run/docker.sock'].includes(dockerHost)) throw new Error(usage)
  // Ignore inherited remote contexts and TLS settings: every operation,
  // including cleanup, must reach the explicitly selected local socket.
  const dockerEnvironment = { ...process.env, DOCKER_HOST: dockerHost }
  for (const name of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnvironment[name]
  const runId = `${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactDirectory = path.resolve('test-results', `ai-linux-lock-${runId}`)
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'ai-linux-lock-fixture-'))
  await chmod(fixtureDirectory, 0o755)
  const source = fileURLToPath(import.meta.url)
  for (const name of ['gate.mjs', 'codex-lock-shim.mjs']) { await copyFile(source, path.join(fixtureDirectory, name)); await chmod(path.join(fixtureDirectory, name), 0o555) }
  const transcript = []
  const containers = []
  const volumes = []
  const docker = async (commandArgs, timeoutMs) => {
    const result = await command('docker', ['--host', dockerHost, ...commandArgs], timeoutMs, dockerEnvironment)
    transcript.push({ args: commandArgs, ...result })
    await writeFile(path.join(artifactDirectory, 'docker-transcript.json'), JSON.stringify(transcript, null, 2), { mode: 0o600 })
    return result
  }
  const must = (result) => { if (result.exitCode !== 0) throw new Error(`DOCKER_FAILED:${result.stderr.trim()}`); return result.stdout.trim() }
  const hardening = ['--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--cpus', '1', '--tmpfs', '/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728']
  const mounts = (volume) => ['--mount', `type=volume,src=${volume},dst=/oauth`, '--mount', `type=bind,src=${fixtureDirectory},dst=/fixture,readonly`, '--mount', `type=bind,src=${path.join(fixtureDirectory, 'gate.mjs')},dst=/opt/ai/scripts/run-ai-worker.ts,readonly`]
  let result
  try {
    const imageData = JSON.parse(must(await docker(['image', 'inspect', image])))
    if (imageData[0]?.Os !== 'linux' || imageData[0]?.Config?.User !== 'node') throw new Error('EXPECTED_NONROOT_LINUX_IMAGE')
    await writeFile(path.join(artifactDirectory, 'image.json'), JSON.stringify(imageData, null, 2), { mode: 0o600 })
    const cases = []
    for (const dropInheritedFd of [false, true]) {
      const mode = dropInheritedFd ? 'negative' : 'positive'
      const volume = `ai-linux-lock-${runId}-${mode}`
      const anchor = `${volume}-anchor`
      volumes.push(volume)
      must(await docker(['volume', 'create', '--label', `walldecor.ai-linux-lock=${runId}`, volume]))
      containers.push(anchor)
      must(await docker(['run', '-d', '--name', anchor, ...hardening, ...mounts(volume), '--entrypoint', '/usr/local/bin/node', image, FIXTURE, '--inside-anchor', ...(dropInheritedFd ? ['--drop-inherited-fd'] : [])]))
      const control = async (operation) => {
        const output = await docker(['exec', anchor, '/usr/local/bin/node', FIXTURE, '--inside-control', operation], 10_000)
        return JSON.parse(must(output))
      }
      const awaitSnapshot = async (predicate, label) => {
        const deadline = Date.now() + 30_000
        let last
        while (Date.now() < deadline) {
          try { last = await control('snapshot'); if (predicate(last)) return last } catch { /* Anchor startup may not have opened the control listener yet. */ }
          await delay(200)
        }
        throw new Error(`WAIT_TIMEOUT:${label}:${JSON.stringify(last)}`)
      }
      let contenderIndex = 0
      const contender = async () => {
        const name = `${volume}-contender-${++contenderIndex}`
        containers.push(name)
        const output = await docker(['run', '--name', name, ...hardening, ...mounts(volume), '--env', 'LINUX_LOCK_GATE_CONTENDER=1', image, 'worker'])
        let entered = false
        try { entered = JSON.parse(output.stdout.trim()).entered === true } catch { /* Expected for the blocked process. */ }
        return { ...output, entered }
      }
      const before = await awaitSnapshot((proof) => proof.provider?.inferenceStarted && roleAlive(proof.processes, 'native-cli'), 'inference')
      before.contender = await contender()
      await control('kill-supervisor')
      const afterSupervisorKilled = await awaitSnapshot((proof) => proof.supervisorExit?.signal === 'SIGKILL', 'supervisor-killed')
      afterSupervisorKilled.contender = await contender()
      // The CLI must still be alive after the competing entrypoint finishes.
      const afterContention = await control('snapshot')
      afterSupervisorKilled.processes = afterContention.processes
      await control('release')
      const afterDescendantExit = await awaitSnapshot((proof) => proof.cliExit && !proof.processes.some((process) => ['npm-launcher', 'native-cli', 'shim'].includes(process.role) && live(process)), 'cli-exited')
      afterDescendantExit.contender = await contender()
      const proof = { mode, dropInheritedFd, version: before.version, platform: before.platform, before, afterSupervisorKilled, afterDescendantExit, provider: afterDescendantExit.provider }
      const assessment = assessSessionCase(proof)
      cases.push({ ...proof, assessment })
      await writeFile(path.join(artifactDirectory, `${mode}.json`), JSON.stringify({ ...proof, assessment }, null, 2), { mode: 0o600 })
      await docker(['exec', anchor, '/usr/local/bin/node', '-e', 'process.stdout.write(require("node:fs").readFileSync("/runtime/proof/image-files.json","utf8"))']).then((output) => writeFile(path.join(artifactDirectory, `${mode}-image-files.json`), must(output), { mode: 0o600 }))
      process.stdout.write(`${mode}: ${JSON.stringify(assessment)}\n`)
      must(await docker(['rm', '-f', anchor]))
      containers.splice(containers.indexOf(anchor), 1)
    }
    const [positive, negative] = cases
    const { passed, negativeControlDetected } = assessSessionReport(positive, negative)
    result = { passed, artifactDirectory, imageId: imageData[0].Id, image, dockerHost, fixtureDirectory, negativeControlDetected, cases,
      limits: ['Synthetic provider only; no OAuth credentials or external model calls.', 'Synthetic read-only fixture mounted over worker supervisor; real entrypoint and runCodexJob are unchanged.', 'Anchor replaces image tini as PID1 solely to keep descendants alive after killing only the supervisor.', 'Actual npm launcher may retain the lock while its native child does not; the proof records each FD holder.', 'No repository, user-home, database, Docker socket, or host port mounted. Only new private synthetic volumes and temporary fixtures.'],
    }
  } catch (error) {
    result = { passed: false, artifactDirectory, image, dockerHost, fixtureDirectory, error: String(error.message) }
  } finally {
    const cleanup = []
    for (const name of [...containers].reverse()) cleanup.push({ type: 'container', name, result: await docker(['rm', '-f', name]).catch((error) => ({ exitCode: -1, error: String(error.message) })) })
    for (const name of [...volumes].reverse()) cleanup.push({ type: 'volume', name, result: await docker(['volume', 'rm', name]).catch((error) => ({ exitCode: -1, error: String(error.message) })) })
    result ??= { passed: false, artifactDirectory }
    result.cleanup = cleanup
    result.cleanupPassed = cleanup.every((entry) => entry.result.exitCode === 0)
    result.passed &&= result.cleanupPassed
    await writeFile(path.join(artifactDirectory, 'summary.json'), JSON.stringify(result, null, 2), { mode: 0o600 })
  }
  process.stdout.write(`${JSON.stringify({ passed: result.passed, artifactDirectory, negativeControlDetected: result.negativeControlDetected, error: result.error, cleanupPassed: result.cleanupPassed }, null, 2)}\n`)
  process.exitCode = result.passed ? 0 : 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (path.basename(invokedPath) === 'run-ai-worker.ts') {
  supervisorMain().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
} else if (path.basename(invokedPath) === 'codex-lock-shim.mjs') {
  shimMain().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
} else if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const action = process.argv[2] === '--inside-anchor' ? anchorMain : process.argv[2] === '--inside-control' ? controlMain : hostMain
  action().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
