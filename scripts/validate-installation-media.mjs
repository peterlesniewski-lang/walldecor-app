import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import QRCode from 'qrcode'
import { stopServerGracefully } from './validate-installation-order-utils.mjs'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-media-validator-'))
const databasePath = path.join(databaseDirectory, 'media.db')
const databaseUrl = `file:${databasePath}`
const mediaRoot = mkdtempSync('/tmp/walldecor-installations-e2e-media-validator-')
const password = 'Validator-Installation-Media-2026!'
const authSecret = 'validator-installation-media-secret-only'
const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLxVwAAAABJRU5ErkJggg==', 'base64')

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
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from './src/generated/prisma'
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'MVAL', name: 'Walidator prywatnych plików' } })
  const [owner, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Media', email: 'validator.media.owner@example.test', position: 'Koordynatorka', costCenterId: 'MVAL', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Media', email: 'validator.media.backup@example.test', position: 'Koordynator', costCenterId: 'MVAL', startDate: new Date('2026-01-01'), active: true } }),
  ])
  const passwordHash = await bcrypt.hash(process.env.VALIDATOR_PASSWORD, 10)
  const admin = await db.user.create({ data: { username: 'mediavalidatoradmin', name: 'Administrator walidatora plików', email: 'validator.media.admin@example.test', role: 'ADMIN', passwordHash } })
  const client = await db.installationClient.create({ data: { name: 'Klient walidatora plików', email: 'validator.media.client@example.test', phone: '+48 501 111 222' } })
  const order = await db.installationOrder.create({ data: { number: 'MON-VALIDATOR-MEDIA', status: 'DRAFT', clientId: client.id, addressStreet: 'Montażowa', addressBuildingNumber: '7', addressPostalCode: '00-007', addressCity: 'Warszawa', primaryEmployeeId: owner.id, backupEmployeeId: backup.id } })
  const template = await db.installationFormTemplate.create({ data: { familyId: 'validator-media', name: 'Walidator plików', nameKey: 'walidator-plikow', version: 1, status: 'PUBLISHED', publishedAt: new Date(), createdById: admin.id, questionDefinitions: { create: [{ key: 'zdjecie-przed-montazem', type: 'FILE', label: 'Zdjęcie przed montażem', required: true, sortOrder: 0 }] } } })
  const questions = [{ key: 'zdjecie-przed-montazem', type: 'FILE', label: 'Zdjęcie przed montażem', required: true }]
  await db.installationOrderFormSnapshot.create({ data: { orderId: order.id, templateId: template.id, templateVersion: 1, schemaJson: JSON.stringify({ familyId: template.familyId, templateId: template.id, name: template.name, version: 1, questions }), createdById: admin.id } })
  const token = randomBytes(32).toString('base64url')
  await db.installationClientLink.create({ data: { orderId: order.id, createdById: admin.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000) } })
  console.log(JSON.stringify({ orderId: order.id, token }))
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
  if (!address || typeof address === 'string') throw new Error('Nie udało się wybrać portu walidatora mediów.')
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_URL: `http://127.0.0.1:${port}`, NEXTAUTH_SECRET: authSecret, INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem', INSTALLATION_MEDIA_TEST_ROOT: mediaRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += chunk.toString() })
  server.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { server, output: () => output }
}

async function waitForServer(baseUrl, running) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (running.server.exitCode !== null) throw new Error(`Serwer walidatora mediów zakończył się przed startem: ${running.output()}`)
    try { if ((await fetch(`${baseUrl}/api/auth/csrf`)).ok) return } catch { /* Next kompiluje route. */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Serwer walidatora mediów nie wystartował: ${running.output()}`)
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

async function request(baseUrl, jar, endpoint, options = {}) {
  const headers = new Headers(options.headers); if (jar.header()) headers.set('Cookie', jar.header())
  const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers }); jar.add(response)
  return response
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: HTTP ${response.status}, oczekiwano ${expected}`)
}

async function login(baseUrl) {
  const jar = cookieJar()
  const csrf = await request(baseUrl, jar, '/api/auth/csrf'); expectStatus(csrf, 200, 'CSRF loginu')
  const { csrfToken } = await csrf.json()
  const response = await request(baseUrl, jar, '/api/auth/callback/credentials', {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, username: 'mediavalidatoradmin', password, callbackUrl: `${baseUrl}/dashboard`, json: 'true' }),
  })
  if (![200, 302].includes(response.status)) throw new Error(`Login admina: HTTP ${response.status}`)
  const session = await request(baseUrl, jar, '/api/auth/session'); if (!(await session.json())?.user?.id) throw new Error('Login admina nie ustanowił sesji.')
  return jar
}

let running
let port
try {
  applyCommittedMigrations()
  const { orderId, token } = seedDatabase()
  port = await getFreePort(); const baseUrl = `http://127.0.0.1:${port}`
  running = startServer(port); await waitForServer(baseUrl, running)

  const publicJar = cookieJar()
  const handoffResponse = await request(baseUrl, publicJar, `/api/public/installations/${token}/handoffs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionKey: 'zdjecie-przed-montazem' }) })
  expectStatus(handoffResponse, 201, 'Utworzenie przekazania QR')
  const handoff = await handoffResponse.json()
  const code = new URL(handoff.handoffUrl).pathname.split('/').at(-1)
  if (!code || handoff.qrSvg !== await QRCode.toString(handoff.handoffUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })) throw new Error('QR_HANDOFF_URL_ENCODING_FAILED')
  const mobileJar = cookieJar()
  const redeem = await request(baseUrl, mobileJar, `/api/public/mobile-upload/${code}/redeem`, { method: 'POST' })
  expectStatus(redeem, 200, 'Jednorazowe odebranie przekazania QR')
  const form = new FormData(); form.set('file', new Blob([validPng], { type: 'image/png' }), 'mobilne-zdjecie.png')
  const upload = await request(baseUrl, mobileJar, '/api/public/mobile-upload/session/files', { method: 'POST', body: form })
  expectStatus(upload, 201, 'Mobilne przesłanie prawidłowego PNG')
  const uploaded = await upload.json()
  const expectedSha = createHash('sha256').update(validPng).digest('hex')
  if (uploaded.file?.sha256 !== expectedSha) throw new Error('UPLOAD_SHA_READBACK_FAILED')

  await stopServer(running, port); running = startServer(port); await waitForServer(baseUrl, running)
  const adminJar = await login(baseUrl)
  const downloadPath = `/api/installations/${orderId}/files/${uploaded.file.id}`
  const download = await request(baseUrl, adminJar, downloadPath)
  expectStatus(download, 200, 'Pobranie przez aplikację po realnym restarcie Next')
  if (createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex') !== expectedSha) throw new Error('RESTART_DOWNLOAD_SHA_FAILED')
  const submitProjection = await request(baseUrl, publicJar, `/api/public/installations/${token}`)
  expectStatus(submitProjection, 200, 'Odczyt formularza po restarcie')
  const projection = await submitProjection.json()
  const submit = await request(baseUrl, publicJar, `/api/public/installations/${token}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisionNumber: projection.submission.revisionNumber, draftVersion: projection.submission.draftVersion, clientMutationId: 'validator-media-submit-0001' }) })
  expectStatus(submit, 200, 'Wysłanie formularza z wymaganym plikiem')
  const revoke = await request(baseUrl, publicJar, `/api/public/installations/${token}/handoffs/${handoff.handoffId}`, { method: 'DELETE' })
  expectStatus(revoke, 200, 'Cofnięcie przekazania QR')
  const deniedForm = new FormData(); deniedForm.set('file', new Blob([validPng], { type: 'image/png' }), 'po-cofnieciu.png')
  const deniedMobile = await request(baseUrl, mobileJar, '/api/public/mobile-upload/session/files', { method: 'POST', body: deniedForm })
  expectStatus(deniedMobile, 404, 'Mobilny upload po cofnięciu przekazania')
  const remove = await request(baseUrl, adminJar, downloadPath, { method: 'DELETE' })
  expectStatus(remove, 200, 'Soft-delete pliku')
  const deniedDownload = await request(baseUrl, adminJar, downloadPath)
  expectStatus(deniedDownload, 404, 'Pobranie po soft-delete')

  await stopServer(running, port); running = undefined
  console.log(JSON.stringify({ status: 'ok', orderId, restart: 'verified', sha256: expectedSha }))
} finally {
  if (running) await stopServer(running, port)
  rmSync(databaseDirectory, { recursive: true, force: true })
  rmSync(mediaRoot, { recursive: true, force: true })
}
