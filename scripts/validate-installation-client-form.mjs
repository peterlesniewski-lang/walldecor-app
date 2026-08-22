import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopServerGracefully } from './validate-installation-order-utils.mjs'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-client-form-validator-'))
const databasePath = path.join(databaseDirectory, 'client-form.db')
const databaseUrl = `file:${databasePath}`
const password = 'Validator-Client-Form-2026!'
const authSecret = 'validator-client-form-secret-only'

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

function applyCommittedMigrations() {
  const migrations = readdirSync(path.join(workspace, 'prisma', 'migrations')).sort()
    .map((directory) => path.join(workspace, 'prisma', 'migrations', directory, 'migration.sql')).filter(existsSync)
  for (const migration of migrations) runChecked('sqlite3', ['-bail', databasePath], { input: readFileSync(migration, 'utf8') })
}

function seedDatabase() {
  const program = `
import bcrypt from 'bcryptjs'
import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'VCF', name: 'Walidator formularza klienta' } })
  const [primary, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'client-form.owner@example.test', position: 'Koordynatorka', costCenterId: 'VCF', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'client-form.backup@example.test', position: 'Koordynator', costCenterId: 'VCF', startDate: new Date('2026-01-01'), active: true } }),
  ])
  const passwordHash = await bcrypt.hash(process.env.VALIDATOR_PASSWORD, 10)
  const admin = await db.user.create({ data: { username: 'clientformadmin', name: 'Administrator walidatora', email: 'client-form.admin@example.test', role: 'ADMIN', passwordHash } })
  const template = await db.installationFormTemplate.create({ data: {
    familyId: 'validator-client-form', name: 'Walidator klienta', nameKey: 'walidator-klienta', version: 1, status: 'PUBLISHED', publishedAt: new Date(), createdById: admin.id,
    questionDefinitions: { create: [
      { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, riskLevel: 'HIGH', sortOrder: 0 },
      { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm ma glif?', required: true, conditionJson: JSON.stringify({ questionKey: 'glify', equals: 'YES' }), sortOrder: 1 },
      { key: 'kolor', type: 'SINGLE', label: 'Kolor ściany', optionsJson: JSON.stringify(['biały', 'beżowy']), sortOrder: 2 },
    ] },
  } })
  console.log(JSON.stringify({ primaryEmployeeId: primary.id, backupEmployeeId: backup.id, templateId: template.id }))
} finally { await db.$disconnect() }
`
  return JSON.parse(runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', program], {
    env: { ...process.env, DATABASE_URL: databaseUrl, VALIDATOR_PASSWORD: password },
  }))
}

async function getFreePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('Nie udało się wybrać portu walidatora formularza.')
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_URL: `http://127.0.0.1:${port}`, NEXTAUTH_SECRET: authSecret },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk.toString() })
  server.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { server, output: () => output }
}

async function waitForServer(baseUrl, running) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (running.server.exitCode !== null) throw new Error(`Serwer walidatora zakończył się przed startem: ${running.output()}`)
    try { if ((await fetch(`${baseUrl}/api/auth/csrf`)).ok) return } catch { /* Next kompiluje route. */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Serwer walidatora nie wystartował: ${running.output()}`)
}

async function assertPortReleased(port) {
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
}

async function stopServer(running, port) { await stopServerGracefully(running, () => assertPortReleased(port)) }

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

async function login(baseUrl) {
  const jar = cookieJar(); const csrf = await fetch(`${baseUrl}/api/auth/csrf`); jar.add(csrf)
  if (!csrf.ok) throw new Error(`CSRF loginu: HTTP ${csrf.status}`)
  const { csrfToken } = await csrf.json()
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, username: 'clientformadmin', password, callbackUrl: `${baseUrl}/dashboard`, json: 'true' }),
  })
  jar.add(response)
  if (![200, 302].includes(response.status)) throw new Error(`Login admina: HTTP ${response.status}`)
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: jar.header() } }); jar.add(session)
  if (!(await session.json())?.user?.id) throw new Error('Login admina nie ustanowił sesji.')
  return jar
}

async function request(baseUrl, jar, endpoint, options = {}) {
  const headers = new Headers(options.headers); headers.set('Cookie', jar.header())
  const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers }); jar.add(response)
  return response
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: HTTP ${response.status}, oczekiwano ${expected}`)
}

function directEvidence(input) {
  const program = `
import { createHash } from 'node:crypto'
import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const [links, submissions, clarifications, foreignKeys, integrity] = await Promise.all([
    db.installationClientLink.findMany({ where: { orderId: process.env.ORDER_ID }, select: { tokenHash: true, revokedAt: true, lastOpenedAt: true } }),
    db.installationFormSubmission.findMany({ where: { orderId: process.env.ORDER_ID }, include: { answers: true }, orderBy: { revisionNumber: 'asc' } }),
    db.installationClarification.findMany({ where: { orderId: process.env.ORDER_ID }, select: { status: true, isBlocking: true, resolvedAt: true } }),
    db.$queryRawUnsafe('PRAGMA foreign_key_check'), db.$queryRawUnsafe('PRAGMA integrity_check'),
  ])
  const token = process.env.CLIENT_TOKEN
  if (links.some((link) => link.tokenHash === token || !/^[a-f0-9]{64}$/.test(link.tokenHash))) throw new Error('TOKEN_STORAGE_FAILED')
  if (!links.some((link) => link.tokenHash === createHash('sha256').update(token).digest('hex') && link.revokedAt && link.lastOpenedAt)) throw new Error('LINK_LIFECYCLE_READBACK_FAILED')
  if (submissions.length !== 2 || submissions.some((submission) => submission.status !== 'SUBMITTED') || submissions[1].revisionOfId !== submissions[0].id) throw new Error('IMMUTABLE_REVISION_READBACK_FAILED')
  if (!submissions[0].answers.some((answer) => answer.questionKey === 'glify' && answer.isUnknown) || !submissions[1].answers.some((answer) => answer.questionKey === 'glify-cm' && answer.normalizedValue === '12.5')) throw new Error('ANSWER_READBACK_FAILED')
  if (clarifications.length !== 1 || clarifications[0].status !== 'RESOLVED' || !clarifications[0].resolvedAt || !clarifications[0].isBlocking) throw new Error('READINESS_CLARIFICATION_READBACK_FAILED')
  if (foreignKeys.length !== 0 || integrity[0]?.integrity_check !== 'ok') throw new Error('SQLITE_INTEGRITY_FAILED')
} finally { await db.$disconnect() }
`
  runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', program], {
    env: { ...process.env, DATABASE_URL: databaseUrl, ORDER_ID: input.orderId, CLIENT_TOKEN: input.token },
  })
}

let running
let port
try {
  applyCommittedMigrations()
  const { primaryEmployeeId, backupEmployeeId, templateId } = seedDatabase()
  port = await getFreePort(); const baseUrl = `http://127.0.0.1:${port}`
  running = startServer(port); await waitForServer(baseUrl, running)
  let admin = await login(baseUrl)
  const orderResponse = await request(baseUrl, admin, '/api/installations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: { name: 'Marta Walidator', email: 'private-client@example.test', phone: '+48 501 222 333' }, address: { street: 'Tajna', buildingNumber: '17', postalCode: '02-515', city: 'Warszawa' }, primaryEmployeeId, backupEmployeeId }),
  })
  expectStatus(orderResponse, 201, 'Backoffice create order'); const order = await orderResponse.json()
  const roomResponse = await request(baseUrl, admin, `/api/installations/${order.id}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Salon' }) })
  expectStatus(roomResponse, 201, 'Backoffice create room')
  const snapshotResponse = await request(baseUrl, admin, `/api/installations/${order.id}/form-snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId }) })
  expectStatus(snapshotResponse, 201, 'Backoffice create snapshot')
  const linkResponse = await request(baseUrl, admin, `/api/installations/${order.id}/client-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresAt: '2027-01-01T12:00:00.000Z' }) })
  expectStatus(linkResponse, 201, 'Backoffice generate one-time link'); const generated = await linkResponse.json()
  const token = new URL(generated.url).pathname.split('/').at(-1)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) throw new Error('CSPRNG_TOKEN_FORMAT_FAILED')

  const projectionResponse = await fetch(`${baseUrl}/api/public/installations/${token}`)
  expectStatus(projectionResponse, 200, 'Anonymous public projection'); const projection = await projectionResponse.json()
  const projectionText = JSON.stringify(projection)
  for (const forbidden of ['private-client@example.test', 'Tajna', 'Warszawa', '501 222', 'price', 'audit', 'backupEmployee', 'employeeId']) if (projectionText.includes(forbidden)) throw new Error(`PUBLIC_PROJECTION_LEAK_${forbidden}`)
  if (projection.brand !== 'WallDecor' || projection.clientName !== 'Marta Walidator' || !projection.rooms.some((room) => room.name === 'Salon')) throw new Error('PUBLIC_PROJECTION_REQUIRED_FIELDS_FAILED')
  const initial = projection.submission
  const mutation = { submissionId: initial.id, draftVersion: initial.draftVersion, clientMutationId: 'validator-autosave-0001', answers: [{ questionKey: 'glify', value: 'UNKNOWN' }, { questionKey: 'kolor', value: 'biały' }] }
  const autosave = await fetch(`${baseUrl}/api/public/installations/${token}/autosave`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) })
  expectStatus(autosave, 200, 'Public autosave'); const saved = await autosave.json()
  const replay = await fetch(`${baseUrl}/api/public/installations/${token}/autosave`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) })
  expectStatus(replay, 200, 'Idempotent autosave replay')
  if (JSON.stringify(saved) !== JSON.stringify(await replay.json())) throw new Error('AUTOSAVE_REPLAY_FAILED')
  const malformed = await fetch(`${baseUrl}/api/public/installations/${token}/autosave`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) })
  expectStatus(malformed, 400, 'Strict public autosave plain-object validation')

  await stopServer(running, port); running = startServer(port); await waitForServer(baseUrl, running)
  const afterRestart = await fetch(`${baseUrl}/api/public/installations/${token}`); expectStatus(afterRestart, 200, 'Public draft after server restart')
  const restartedProjection = await afterRestart.json()
  if (restartedProjection.submission.draftVersion !== saved.draftVersion || !restartedProjection.submission.answers.some((answer) => answer.questionKey === 'glify' && answer.value === 'UNKNOWN')) throw new Error('AUTOSAVE_RESTART_READBACK_FAILED')
  const submitPayload = { submissionId: saved.id, draftVersion: saved.draftVersion, clientMutationId: 'validator-submit-0001' }
  const [firstSubmit, secondSubmit] = await Promise.all([1, 2].map(() => fetch(`${baseUrl}/api/public/installations/${token}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submitPayload) })))
  expectStatus(firstSubmit, 200, 'Concurrent public submit first'); expectStatus(secondSubmit, 200, 'Concurrent public submit idempotent replay')
  const firstSubmitted = await firstSubmit.json(); const secondSubmitted = await secondSubmit.json()
  if (firstSubmitted.status !== 'SUBMITTED' || JSON.stringify(firstSubmitted) !== JSON.stringify(secondSubmitted)) throw new Error('CONCURRENT_SUBMIT_IDEMPOTENCY_FAILED')

  admin = await login(baseUrl)
  const clarificationsResponse = await request(baseUrl, admin, `/api/installations/${order.id}/clarifications`); expectStatus(clarificationsResponse, 200, 'Owner clarification read')
  const clarifications = await clarificationsResponse.json(); const open = clarifications.find((item) => item.status === 'OPEN' && item.questionKey === 'glify')
  if (!open?.isBlocking) throw new Error('READINESS_BLOCK_NOT_CREATED')
  const resolve = await request(baseUrl, admin, `/api/installations/${order.id}/clarifications/${open.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'RESOLVE', resolution: 'Glif 12 cm', note: 'Potwierdzone z klientką.' }) })
  expectStatus(resolve, 200, 'Owner resolve clarification')
  const correction = await fetch(`${baseUrl}/api/public/installations/${token}/correction`, { method: 'POST' }); expectStatus(correction, 201, 'Public correction')
  const correctionDraft = await correction.json()
  const correctionSave = await fetch(`${baseUrl}/api/public/installations/${token}/autosave`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: correctionDraft.id, draftVersion: correctionDraft.draftVersion, clientMutationId: 'validator-correction-save-01', answers: [{ questionKey: 'glify', value: 'YES' }, { questionKey: 'glify-cm', value: '12,5' }] }) })
  expectStatus(correctionSave, 200, 'Correction autosave'); const correctionSaved = await correctionSave.json()
  const correctionSubmit = await fetch(`${baseUrl}/api/public/installations/${token}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: correctionSaved.id, draftVersion: correctionSaved.draftVersion, clientMutationId: 'validator-correction-submit-01' }) })
  expectStatus(correctionSubmit, 200, 'Correction submit')
  if ((await correctionSubmit.json()).revisionNumber !== 2) throw new Error('CORRECTION_REVISION_NUMBER_FAILED')

  const revoke = await request(baseUrl, admin, `/api/installations/${order.id}/client-link`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REVOKE', linkId: generated.link.id }) })
  expectStatus(revoke, 200, 'Backoffice revoke link')
  const expiredToken = randomBytes(32).toString('base64url')
  const insertExpired = `
import { createHash } from 'node:crypto'; import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }); try { await db.installationClientLink.create({ data: { orderId: process.env.ORDER_ID, createdById: process.env.CREATED_BY, tokenHash: createHash('sha256').update(process.env.EXPIRED_TOKEN).digest('hex'), expiresAt: new Date('2020-01-01') } }) } finally { await db.$disconnect() }
`
  runChecked(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', insertExpired], { env: { ...process.env, DATABASE_URL: databaseUrl, ORDER_ID: order.id, CREATED_BY: 'validator-expired', EXPIRED_TOKEN: expiredToken } })
  const unavailable = []
  for (const candidate of [token, expiredToken, randomBytes(32).toString('base64url')]) {
    const response = await fetch(`${baseUrl}/api/public/installations/${candidate}`); expectStatus(response, 404, 'Generic unavailable link')
    unavailable.push(await response.text())
  }
  if (new Set(unavailable).size !== 1) throw new Error('GENERIC_PUBLIC_404_FAILED')
  directEvidence({ orderId: order.id, token })
  await stopServer(running, port); running = undefined
  console.log(JSON.stringify({ status: 'ok', orderId: order.id, revisions: 2, public404: 'identical', tokenStorage: 'sha256-only' }))
} finally {
  if (running) await stopServer(running, port)
  rmSync(databaseDirectory, { recursive: true, force: true })
}
