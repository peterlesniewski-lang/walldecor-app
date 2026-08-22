import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopServerGracefully } from './validate-installation-order-utils.mjs'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-catalog-validator-'))
const databasePath = path.join(databaseDirectory, 'catalog.db')
const databaseUrl = `file:${databasePath}`
const password = 'Validator-Installation-Catalog-2026!'
const nextAuthSecret = 'validator-installation-catalog-secret-only'

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Proces ${command} ${args.join(' ')} zakończył się kodem ${result.status}: ${result.stderr || result.stdout}`)
  return result.stdout
}

function applyCommittedMigrations() {
  const migrations = readdirSync(path.join(workspace, 'prisma', 'migrations')).sort()
    .map((directory) => path.join(workspace, 'prisma', 'migrations', directory, 'migration.sql')).filter(existsSync)
  for (const migration of migrations) runChecked('sqlite3', ['-bail', databasePath], { input: readFileSync(migration, 'utf8') })
}

function seedDatabase() {
  const seed = `
import bcrypt from 'bcryptjs'
import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'ICV', name: 'Walidator katalogu montaży' } })
  const [primary, backup, outsider] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'catalog-validator.primary@example.test', position: 'Koordynatorka', costCenterId: 'ICV', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'catalog-validator.backup@example.test', position: 'Koordynator', costCenterId: 'ICV', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Ola', lastName: 'Obca', email: 'catalog-validator.outsider@example.test', position: 'Koordynatorka', costCenterId: 'ICV', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
  ])
  const passwordHash = await bcrypt.hash(process.env.VALIDATOR_PASSWORD, 10)
  await Promise.all([
    db.user.create({ data: { username: 'catalogvalidatoradmin', name: 'Administrator walidatora', email: 'catalog-validator.admin@example.test', role: 'ADMIN', passwordHash } }),
    db.user.create({ data: { username: 'catalogvalidatoremployee', name: 'Pracownik walidatora', email: 'catalog-validator.employee@example.test', role: 'EMPLOYEE', employeeId: outsider.id, passwordHash } }),
  ])
  console.log(JSON.stringify({ primaryEmployeeId: primary.id, backupEmployeeId: backup.id }))
} finally { await db.$disconnect() }
`
  return JSON.parse(runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', seed], {
    env: { ...process.env, DATABASE_URL: databaseUrl, VALIDATOR_PASSWORD: password },
  }))
}

async function getFreePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('Nie udało się wybrać portu walidatora katalogu.')
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_URL: `http://127.0.0.1:${port}`, NEXTAUTH_SECRET: nextAuthSecret },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk.toString() })
  server.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { server, output: () => output }
}

async function waitForServer(baseUrl, runningServer) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (runningServer.server.exitCode !== null) throw new Error(`Serwer zakończył się przed gotowością: ${runningServer.output()}`)
    try { if ((await fetch(`${baseUrl}/api/auth/csrf`)).status === 200) return } catch { /* Next kompiluje route. */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Przekroczono czas startu serwera walidatora: ${runningServer.output()}`)
}

async function assertPortReleased(port) {
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', (error) => reject(new Error(`Port ${port} nadal jest zajęty: ${error.message}`))); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
}

async function stopServer(runningServer, port) {
  await stopServerGracefully(runningServer, () => assertPortReleased(port))
}

function cookieJar() {
  const cookies = new Map()
  return {
    add(response) {
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)
      for (const cookie of setCookies) {
        const [pair] = cookie.split(';', 1); const separator = pair.indexOf('=')
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
      }
    },
    header() { return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ') },
  }
}

async function login(baseUrl, username) {
  const jar = cookieJar()
  const csrf = await fetch(`${baseUrl}/api/auth/csrf`); jar.add(csrf)
  if (!csrf.ok) throw new Error(`CSRF loginu: HTTP ${csrf.status}`)
  const { csrfToken } = await csrf.json()
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: `${baseUrl}/dashboard`, json: 'true' }),
  })
  jar.add(response)
  if (![200, 302].includes(response.status)) throw new Error(`Login ${username}: HTTP ${response.status}`)
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: jar.header() } }); jar.add(session)
  if (!(await session.json())?.user?.id) throw new Error(`Login ${username} nie ustanowił sesji.`)
  return jar
}

async function request(baseUrl, jar, endpoint, options = {}) {
  const headers = new Headers(options.headers); headers.set('Cookie', jar.header())
  const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers }); jar.add(response)
  return response
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: oczekiwano HTTP ${expected}, otrzymano ${response.status}`)
}

function verifyDatabase({ orderId, productId, templateId }) {
  const program = `
import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const [product, snapshot, scopeProduct, auditCount, foreignKeys, integrity] = await Promise.all([
    db.installationCatalogProduct.findUnique({ where: { id: process.env.PRODUCT_ID } }),
    db.installationOrderFormSnapshot.findUnique({ where: { orderId: process.env.ORDER_ID } }),
    db.installationScopeProduct.findFirst({ where: { scope: { room: { orderId: process.env.ORDER_ID } } } }),
    db.installationAuditEvent.count({ where: { orderId: process.env.ORDER_ID, action: { in: ['INSTALLATION_MEASUREMENT_CREATED', 'INSTALLATION_MEASUREMENT_UPDATED', 'INSTALLATION_MEASUREMENT_DELETED'] } } }),
    db.$queryRawUnsafe('PRAGMA foreign_key_check'), db.$queryRawUnsafe('PRAGMA integrity_check'),
  ])
  if (!product || product.isActive || !product.archivedAt) throw new Error('CATALOG_ARCHIVE_READBACK_FAILED')
  if (!snapshot || snapshot.templateId !== process.env.TEMPLATE_ID || snapshot.templateVersion !== 1) throw new Error('TEMPLATE_SNAPSHOT_READBACK_FAILED')
  if (!scopeProduct || scopeProduct.productNameSnapshot !== 'Misty Grey' || scopeProduct.productCodeSnapshot !== 'MG-01') throw new Error('SCOPE_SNAPSHOT_READBACK_FAILED')
  if (auditCount !== 3) throw new Error('MEASUREMENT_AUDIT_READBACK_FAILED')
  if (foreignKeys.length !== 0 || integrity[0]?.integrity_check !== 'ok') throw new Error('SQLITE_INTEGRITY_FAILED')
} finally { await db.$disconnect() }
`
  runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', program], {
    env: { ...process.env, DATABASE_URL: databaseUrl, ORDER_ID: orderId, PRODUCT_ID: productId, TEMPLATE_ID: templateId },
  })
}

let runningServer
let validatorPort
try {
  applyCommittedMigrations()
  const { primaryEmployeeId, backupEmployeeId } = seedDatabase()
  validatorPort = await getFreePort()
  const baseUrl = `http://127.0.0.1:${validatorPort}`
  runningServer = startServer(validatorPort)
  await waitForServer(baseUrl, runningServer)
  const admin = await login(baseUrl, 'catalogvalidatoradmin')
  const employee = await login(baseUrl, 'catalogvalidatoremployee')

  const forbidden = await request(baseUrl, employee, '/api/installations/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'category', name: 'Tapety' }) })
  assertStatus(forbidden, 403, 'Katalog dla EMPLOYEE bez uprawnień')
  const categoryResponse = await request(baseUrl, admin, '/api/installations/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'category', name: 'Tapety' }) })
  assertStatus(categoryResponse, 201, 'HTTP create category'); const category = await categoryResponse.json()
  const typeResponse = await request(baseUrl, admin, '/api/installations/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'type', categoryId: category.id, name: 'Winylowe' }) })
  assertStatus(typeResponse, 201, 'HTTP create type'); const type = await typeResponse.json()
  const productResponse = await request(baseUrl, admin, '/api/installations/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'product', typeId: type.id, name: 'Misty Grey', code: 'MG-01', manufacturer: 'WallDecor', collection: 'Misty' }) })
  assertStatus(productResponse, 201, 'HTTP create product'); const product = await productResponse.json()
  const secondProductResponse = await request(baseUrl, admin, '/api/installations/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'product', typeId: type.id, name: 'Ciepły len' }) })
  assertStatus(secondProductResponse, 201, 'HTTP create second product')

  const templateResponse = await request(baseUrl, admin, '/api/installations/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Wywiad o glifach', questions: [{ key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', help: 'Nie wiem jest poprawną odpowiedzią.' }, { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm?', condition: { questionKey: 'glify', equals: 'YES' } }] }) })
  assertStatus(templateResponse, 201, 'HTTP create template'); const template = await templateResponse.json()
  const publishResponse = await request(baseUrl, admin, `/api/installations/templates/${template.id}/publish`, { method: 'POST' })
  assertStatus(publishResponse, 200, 'HTTP publish template'); if ((await publishResponse.json()).status !== 'PUBLISHED') throw new Error('TEMPLATE_PUBLISH_READBACK_FAILED')

  const orderPayload = { client: { name: 'Klient walidatora katalogu', email: 'catalog.validator.client@example.test', phone: '+48 501 111 222' }, address: { street: 'Dobra', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' }, primaryEmployeeId, backupEmployeeId }
  const orderResponse = await request(baseUrl, admin, '/api/installations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderPayload) })
  assertStatus(orderResponse, 201, 'HTTP create order'); const order = await orderResponse.json()
  const snapshotResponse = await request(baseUrl, admin, `/api/installations/${order.id}/form-snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: template.id }) })
  assertStatus(snapshotResponse, 201, 'HTTP create template snapshot')
  const roomResponse = await request(baseUrl, admin, `/api/installations/${order.id}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Salon' }) })
  assertStatus(roomResponse, 201, 'HTTP create room'); const room = await roomResponse.json()
  const scopeResponse = await request(baseUrl, admin, `/api/installations/${order.id}/rooms/${room.id}/scopes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ściana TV' }) })
  assertStatus(scopeResponse, 201, 'HTTP create scope'); const scope = await scopeResponse.json()
  const scopeProductResponse = await request(baseUrl, admin, `/api/installations/${order.id}/rooms/${room.id}/scopes/${scope.id}/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogProductId: product.id }) })
  assertStatus(scopeProductResponse, 201, 'HTTP add catalog product')
  const measurementResponse = await request(baseUrl, admin, `/api/installations/${order.id}/rooms/${room.id}/measurements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopeId: scope.id, elementName: 'Szerokość glifu', value: '12.50', unit: 'CM', source: 'EMPLOYEE', authorContext: 'ADMIN' }) })
  assertStatus(measurementResponse, 201, 'HTTP create measurement'); const measurement = await measurementResponse.json()
  const correctedMeasurement = await request(baseUrl, admin, `/api/installations/${order.id}/rooms/${room.id}/measurements/${measurement.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: '13.25' }) })
  assertStatus(correctedMeasurement, 200, 'HTTP update measurement')
  const deleteMeasurement = await request(baseUrl, admin, `/api/installations/${order.id}/rooms/${room.id}/measurements/${measurement.id}`, { method: 'DELETE' })
  assertStatus(deleteMeasurement, 200, 'HTTP delete measurement')

  const archiveResponse = await request(baseUrl, admin, `/api/installations/catalog/product/${product.id}`, { method: 'DELETE' })
  assertStatus(archiveResponse, 200, 'HTTP archive product')
  const catalogResponse = await request(baseUrl, admin, '/api/installations/catalog')
  assertStatus(catalogResponse, 200, 'HTTP active catalog readback')
  if (JSON.stringify(await catalogResponse.json()).includes('Misty Grey')) throw new Error('ARCHIVED_PRODUCT_STILL_OFFERED')
  const roomsResponse = await request(baseUrl, admin, `/api/installations/${order.id}/rooms`)
  assertStatus(roomsResponse, 200, 'HTTP scope snapshot readback')
  if (!(await roomsResponse.json()).some((row) => row.scopes.some((entry) => entry.scopeProducts.some((item) => item.productNameSnapshot === 'Misty Grey')))) throw new Error('HISTORIC_SCOPE_SNAPSHOT_MISSING')

  await stopServer(runningServer, validatorPort); runningServer = startServer(validatorPort); await waitForServer(baseUrl, runningServer)
  const restartedAdmin = await login(baseUrl, 'catalogvalidatoradmin')
  const restartRooms = await request(baseUrl, restartedAdmin, `/api/installations/${order.id}/rooms`)
  assertStatus(restartRooms, 200, 'HTTP rooms after restart')
  if (!(await restartRooms.json()).some((row) => row.name === 'Salon')) throw new Error('RESTART_READBACK_FAILED')
  verifyDatabase({ orderId: order.id, productId: product.id, templateId: template.id })

  await stopServer(runningServer, validatorPort); runningServer = undefined
  console.log(JSON.stringify({ status: 'ok', orderId: order.id, templateId: template.id, productId: product.id }))
} finally {
  if (runningServer) await stopServer(runningServer, validatorPort)
  rmSync(databaseDirectory, { recursive: true, force: true })
}
