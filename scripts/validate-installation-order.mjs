import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopServerGracefully } from './validate-installation-order-utils.mjs'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-validator-'))
const databasePath = path.join(databaseDirectory, 'installation-order.db')
const databaseUrl = `file:${databasePath}`
const password = 'Validator-Installation-2026!'
const nextAuthSecret = 'validator-installation-order-secret-only'

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Proces ${command} ${args.join(' ')} zakończył się kodem ${result.status}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function applyCommittedMigrations() {
  const migrationRoot = path.join(workspace, 'prisma', 'migrations')
  const migrationSqlPaths = readdirSync(migrationRoot)
    .sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)

  for (const migrationSqlPath of migrationSqlPaths) {
    runChecked('sqlite3', ['-bail', databasePath], { input: readFileSync(migrationSqlPath, 'utf8') })
  }
}

async function getFreePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('Nie udało się wybrać portu walidatora.')
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function seedDatabase() {
  const seedProgram = `
import bcrypt from 'bcryptjs'
import { PrismaClient } from './src/generated/prisma'

const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'JAG', name: 'Walidator montaży' } })
  const [primary, backup, outsider] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'validator.primary@example.test', position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2026-01-01T12:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'validator.backup@example.test', position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2026-01-01T12:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Ola', lastName: 'Obca', email: 'validator.outsider@example.test', position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2026-01-01T12:00:00.000Z'), active: true } }),
  ])
  const passwordHash = await bcrypt.hash(process.env.VALIDATOR_PASSWORD, 10)
  await Promise.all([
    db.user.create({ data: { username: 'validatoradmin', name: 'Administrator walidatora', email: 'validator.admin@example.test', role: 'ADMIN', passwordHash } }),
    db.user.create({ data: { username: 'validatoremployee', name: 'Pracownik walidatora', email: 'validator.employee@example.test', role: 'EMPLOYEE', employeeId: outsider.id, passwordHash } }),
  ])
  console.log(JSON.stringify({ primaryEmployeeId: primary.id, backupEmployeeId: backup.id }))
} finally {
  await db.$disconnect()
}
`
  const output = runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', seedProgram], {
    env: { ...process.env, DATABASE_URL: databaseUrl, VALIDATOR_PASSWORD: password },
  })
  return JSON.parse(output)
}

function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NEXTAUTH_URL: `http://127.0.0.1:${port}`,
      NEXTAUTH_SECRET: nextAuthSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk.toString() })
  server.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { server, output: () => output }
}

async function waitForServer(baseUrl, runningServer) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (runningServer.server.exitCode !== null) {
      throw new Error(`Serwer walidatora zakończył się przed gotowością: ${runningServer.output()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/csrf`)
      if (response.status === 200) return
    } catch {
      // Next nadal kompiluje pierwszy route.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Przekroczono czas startu serwera walidatora: ${runningServer.output()}`)
}

async function assertPortReleased(port) {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', (error) => reject(new Error(`Port walidatora ${port} nadal jest zajęty: ${error.message}`)))
    probe.listen(port, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
}

async function stopServer(runningServer, port) {
  await stopServerGracefully(runningServer, () => assertPortReleased(port))
}

function createCookieJar() {
  const cookies = new Map()
  return {
    add(response) {
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean)
      for (const cookie of setCookies) {
        const [pair] = cookie.split(';', 1)
        const separator = pair.indexOf('=')
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
      }
    },
    header() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    },
  }
}

async function login(baseUrl, username) {
  const jar = createCookieJar()
  const csrf = await fetch(`${baseUrl}/api/auth/csrf`)
  jar.add(csrf)
  if (!csrf.ok) throw new Error(`CSRF loginu zwrócił ${csrf.status}`)
  const { csrfToken } = await csrf.json()
  const loginResponse = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: `${baseUrl}/dashboard`, json: 'true' }),
  })
  jar.add(loginResponse)
  if (![200, 302].includes(loginResponse.status)) {
    throw new Error(`Login ${username} zwrócił ${loginResponse.status}`)
  }
  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: jar.header() } })
  jar.add(sessionResponse)
  const session = await sessionResponse.json()
  if (!session?.user?.id) throw new Error(`Login ${username} nie ustanowił sesji.`)
  return jar
}

async function request(baseUrl, jar, endpoint, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('Cookie', jar.header())
  const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers })
  jar.add(response)
  return response
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: oczekiwano HTTP ${expected}, otrzymano ${response.status}`)
}

function verifyDatabase(orderId) {
  const verificationProgram = `
import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const order = await db.installationOrder.findUnique({ where: { id: process.env.ORDER_ID } })
  if (!order || order.status !== 'ARCHIVED' || !order.archivedAt || order.addressBuildingNumber !== '19B') throw new Error('DB_READBACK_FAILED')
} finally {
  await db.$disconnect()
}
`
  runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', verificationProgram], {
    env: { ...process.env, DATABASE_URL: databaseUrl, ORDER_ID: orderId },
  })
}

let runningServer
let validatorPort
try {
  applyCommittedMigrations()
  const { primaryEmployeeId, backupEmployeeId } = seedDatabase()
  const port = await getFreePort()
  validatorPort = port
  const baseUrl = `http://127.0.0.1:${port}`
  runningServer = startServer(port)
  await waitForServer(baseUrl, runningServer)

  const admin = await login(baseUrl, 'validatoradmin')
  const employee = await login(baseUrl, 'validatoremployee')
  const validPayload = {
    client: { name: 'Klient walidatora', email: 'validator.client@example.test', phone: '+48 501 234 567' },
    address: { street: 'Puławska', buildingNumber: '17', postalCode: '02-515', city: 'Warszawa' },
    primaryEmployeeId,
    backupEmployeeId,
  }

  const invalidResponse = await request(baseUrl, admin, '/api/installations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validPayload, client: { ...validPayload.client, email: 'nie-email' } }),
  })
  assertStatus(invalidResponse, 400, 'Walidacja błędnego create')

  const forbiddenResponse = await request(baseUrl, employee, '/api/installations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validPayload),
  })
  assertStatus(forbiddenResponse, 403, 'Polityka create dla obcego EMPLOYEE')

  const createResponse = await request(baseUrl, admin, '/api/installations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validPayload),
  })
  assertStatus(createResponse, 201, 'HTTP create')
  const created = await createResponse.json()

  const listResponse = await request(baseUrl, admin, '/api/installations')
  assertStatus(listResponse, 200, 'HTTP list')
  if (!(await listResponse.json()).some((order) => order.id === created.id)) throw new Error('HTTP_LIST_READBACK_FAILED')

  const detailResponse = await request(baseUrl, admin, `/api/installations/${created.id}`)
  assertStatus(detailResponse, 200, 'HTTP detail')
  if ((await detailResponse.json()).number !== created.number) throw new Error('HTTP_DETAIL_READBACK_FAILED')

  const updateResponse = await request(baseUrl, admin, `/api/installations/${created.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: { buildingNumber: '19B' } }),
  })
  assertStatus(updateResponse, 200, 'HTTP update')
  if ((await updateResponse.json()).addressBuildingNumber !== '19B') throw new Error('HTTP_UPDATE_READBACK_FAILED')

  const archiveResponse = await request(baseUrl, admin, `/api/installations/${created.id}`, { method: 'DELETE' })
  assertStatus(archiveResponse, 200, 'HTTP archive')
  const archived = await archiveResponse.json()
  if (archived.status !== 'ARCHIVED' || !archived.archivedAt) throw new Error('HTTP_ARCHIVE_READBACK_FAILED')

  await stopServer(runningServer, port)
  runningServer = startServer(port)
  await waitForServer(baseUrl, runningServer)
  const restartedAdmin = await login(baseUrl, 'validatoradmin')
  const afterRestart = await request(baseUrl, restartedAdmin, `/api/installations/${created.id}`)
  assertStatus(afterRestart, 200, 'HTTP readback po restarcie')
  const persisted = await afterRestart.json()
  if (persisted.status !== 'ARCHIVED' || persisted.addressBuildingNumber !== '19B') throw new Error('HTTP_RESTART_PERSISTENCE_FAILED')
  verifyDatabase(created.id)

  await stopServer(runningServer, port)
  runningServer = undefined
  console.log(JSON.stringify({ status: 'ok', orderId: created.id, number: created.number, persistedStatus: persisted.status }))
} finally {
  if (runningServer) await stopServer(runningServer, validatorPort)
  rmSync(databaseDirectory, { recursive: true, force: true })
}
