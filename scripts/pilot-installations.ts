import { spawn } from 'node:child_process'
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeSync } from 'node:fs'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'
import { isStrongPassword } from '../src/lib/accounts/policy'

const PILOT_DATABASE_ROOT_PATTERN = /^\/tmp\/walldecor-installations-pilot-[A-Za-z0-9][A-Za-z0-9._-]*$/
const PILOT_MEDIA_PATTERN = /^\/tmp\/walldecor-installations-e2e-media-pilot-[A-Za-z0-9][A-Za-z0-9._-]*$/
const PILOT_DATABASE_FILENAME = 'pilot.db'
const PILOT_MARKER_FILENAME = '.pilot01.marker'
const ADMIN_USERNAME = 'pilotadmin'
const ADMIN_EMAIL = 'pilot-admin@example.test'

export type PilotCommand = 'start' | 'check' | 'reset' | 'help'

export interface PilotConfig {
  baseUrl: string
  port: number
  databaseUrl: string
  databaseRoot: string
  databasePath: string
  mediaRoot: string
  markerPath: string
  bindIp: string
  adminUsername: string
  adminPassword: string
  authSecret: string
  runtimeEnv: NodeJS.ProcessEnv
}

interface PilotChild {
  readonly exitCode: number | null
  kill(signal: NodeJS.Signals): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'error', listener: (error: Error) => void): this
}

export interface PilotDependencies {
  migrate(config: PilotConfig): Promise<void>
  seed(config: PilotConfig): Promise<void>
  start(config: PilotConfig): PilotChild
  waitForReady(config: PilotConfig, child: PilotChild): Promise<void>
  preflightPort(config: PilotConfig): Promise<void>
  localIpv4Addresses(): string[]
  print(line: string): void
  remove(config: PilotConfig): void
}

interface SignalSource {
  on(event: NodeJS.Signals, listener: () => void): unknown
  removeListener(event: NodeJS.Signals, listener: () => void): unknown
}

interface PilotMarker {
  version: 2
  databaseRoot: string
  databasePath: string
  mediaRoot: string
  bindIp: string
  port: number
}

function fail(message: string): never {
  throw new Error(message)
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value || !value.trim()) fail(`Wymagane jest ${name}.`)
  return value
}

function validatePilotDatabase(databaseUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    fail('DATABASE_URL pilota musi być adresem SQLite file:/tmp/.../pilot.db.')
  }
  if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) {
    fail('DATABASE_URL pilota musi być czystym adresem SQLite file:/tmp/.../pilot.db.')
  }

  const databasePath = fileURLToPath(parsed)
  const databaseRoot = path.dirname(databasePath)
  if (
    path.basename(databasePath) !== PILOT_DATABASE_FILENAME
    || path.dirname(databaseRoot) !== '/tmp'
    || !PILOT_DATABASE_ROOT_PATTERN.test(databaseRoot)
    || databasePath !== path.join(databaseRoot, PILOT_DATABASE_FILENAME)
  ) {
    fail('DATABASE_URL może wskazywać wyłącznie file:/tmp/walldecor-installations-pilot-<id>/pilot.db.')
  }
  return { databaseRoot, databasePath }
}

function validatePilotMediaRoot(value: string) {
  const mediaRoot = path.resolve(value)
  if (!PILOT_MEDIA_PATTERN.test(mediaRoot) || path.dirname(mediaRoot) !== '/tmp') {
    fail('PILOT_MEDIA_ROOT może wskazywać wyłącznie /tmp/walldecor-installations-e2e-media-pilot-<id>.')
  }
  return mediaRoot
}

function isPrivateLanIpv4(hostname: string) {
  const octets = hostname.split('.').map((segment) => Number(segment))
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

function validatePilotBaseUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    fail('PILOT_BASE_URL musi mieć postać http://LAN-IP:port.')
  }
  const port = Number(parsed.port)
  if (
    parsed.protocol !== 'http:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || !Number.isInteger(port)
    || port < 1024
    || port > 65535
    || !isPrivateLanIpv4(parsed.hostname)
  ) {
    fail('PILOT_BASE_URL musi być adresem http://LAN-IP:port z prywatnym IPv4, dostępnym dla telefonu w sieci lokalnej.')
  }
  return { baseUrl: parsed.origin, port }
}

function isStrongAuthSecret(value: string) {
  return value.length >= 32 && !/\s/.test(value) && new Set(value).size >= 12
}

function hostLocalIpv4Addresses() {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : undefined
}

function optionalLstat(target: string) {
  try {
    return lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    fail('Odmowa: nie można bezpiecznie sprawdzić ścieżki pilota.')
  }
}

function requireRealPath(target: string) {
  try {
    return realpathSync(target)
  } catch {
    fail(`Odmowa: nie można rozwiązać bezpiecznego katalogu nadrzędnego pilota (${target}).`)
  }
}

function assertParentWithinRealTmp(root: string) {
  const realTmp = path.resolve(requireRealPath('/tmp'))
  const realParent = path.resolve(requireRealPath(path.dirname(root)))
  if (realParent !== realTmp) fail('Odmowa: katalog pilota musi być bezpośrednio w systemowym /tmp.')
}

function assertRootAbsent(root: string, label: string) {
  const stats = optionalLstat(root)
  if (!stats) return
  if (stats.isSymbolicLink()) fail(`Odmowa: ${label} pilota już istnieje jako link.`)
  if (!stats.isDirectory()) fail(`Odmowa: ${label} pilota już istnieje i nie jest katalogiem 0700.`)
  fail(`Odmowa: ${label} pilota już istnieje; użyj jawnego --reset zamiast wznawiać pilot 01.`)
}

function assertPrivatePilotRoot(root: string, label: string, required: boolean) {
  const stats = optionalLstat(root)
  if (!stats) {
    if (required) fail(`Odmowa: brakuje wymaganego ${label} pilota.`)
    return
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) fail(`Odmowa: ${label} pilota musi być prawdziwym katalogiem 0700, nie linkiem.`)
  const uid = currentUid()
  if (uid !== undefined && stats.uid !== uid) fail(`Odmowa: ${label} pilota nie należy do bieżącego użytkownika.`)
  if ((stats.mode & 0o777) !== 0o700) fail(`Odmowa: ${label} pilota musi mieć dokładnie tryb 0700.`)
}

function assertOwnedMarker(config: PilotConfig) {
  const stats = optionalLstat(config.markerPath)
  if (!stats) fail('Odmowa: brakuje markera pilota.')
  if (stats.isSymbolicLink() || !stats.isFile()) fail('Odmowa: marker pilota musi być zwykłym plikiem, nie linkiem.')
  const uid = currentUid()
  if (uid !== undefined && stats.uid !== uid) fail('Odmowa: marker pilota nie należy do bieżącego użytkownika.')
  if (stats.nlink !== 1 || (stats.mode & 0o077) !== 0) fail('Odmowa: marker pilota ma niebezpieczne uprawnienia lub linki.')
}

function assertPilotRootsAbsent(config: PilotConfig) {
  assertParentWithinRealTmp(config.databaseRoot)
  assertParentWithinRealTmp(config.mediaRoot)
  assertRootAbsent(config.databaseRoot, 'katalog bazy danych')
  assertRootAbsent(config.mediaRoot, 'katalog mediów')
}

function assertPilotRootsPrivate(config: PilotConfig, required: boolean) {
  assertParentWithinRealTmp(config.databaseRoot)
  assertParentWithinRealTmp(config.mediaRoot)
  assertPrivatePilotRoot(config.databaseRoot, 'katalog bazy danych', required)
  assertPrivatePilotRoot(config.mediaRoot, 'katalog mediów', required)
}

function markerContent(config: PilotConfig) {
  const marker: PilotMarker = {
    version: 2,
    databaseRoot: config.databaseRoot,
    databasePath: config.databasePath,
    mediaRoot: config.mediaRoot,
    bindIp: config.bindIp,
    port: config.port,
  }
  return `${JSON.stringify(marker)}\n`
}

function parsePilotMarker(raw: string): PilotMarker {
  let marker: unknown
  try {
    marker = JSON.parse(raw)
  } catch {
    fail('Odmowa: marker pilota nie jest poprawnym JSON-em v2.')
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) fail('Odmowa: marker pilota ma nieprawidłowy schemat.')
  const record = marker as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = ['bindIp', 'databasePath', 'databaseRoot', 'mediaRoot', 'port', 'version']
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail('Odmowa: marker pilota ma nieprawidłowy schemat.')
  }
  if (
    record.version !== 2
    || typeof record.databaseRoot !== 'string'
    || typeof record.databasePath !== 'string'
    || typeof record.mediaRoot !== 'string'
    || typeof record.bindIp !== 'string'
    || typeof record.port !== 'number'
    || !Number.isInteger(record.port)
  ) fail('Odmowa: marker pilota ma nieprawidłowy schemat.')
  return {
    version: 2,
    databaseRoot: record.databaseRoot,
    databasePath: record.databasePath,
    mediaRoot: record.mediaRoot,
    bindIp: record.bindIp,
    port: record.port,
  }
}

function assertValidPilotMarker(config: PilotConfig) {
  assertOwnedMarker(config)
  const marker = parsePilotMarker(readFileSync(config.markerPath, 'utf8'))
  if (
    marker.databaseRoot !== config.databaseRoot
    || marker.databasePath !== config.databasePath
    || marker.mediaRoot !== config.mediaRoot
    || marker.bindIp !== config.bindIp
    || marker.port !== config.port
  ) fail('Odmowa: marker nie należy do wskazanego pilota.')
  assertOwnedMarker(config)
}

function createPrivateRoot(root: string, label: string) {
  try {
    mkdirSync(root, { mode: 0o700 })
  } catch {
    fail(`Odmowa: nie udało się atomowo utworzyć ${label} pilota.`)
  }
  assertPrivatePilotRoot(root, label, true)
}

function writeCompleteMarker(config: PilotConfig) {
  const content = Buffer.from(markerContent(config))
  let descriptor: number | undefined
  let complete = false
  try {
    descriptor = openSync(config.markerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    let offset = 0
    while (offset < content.length) offset += writeSync(descriptor, content, offset, content.length - offset)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    complete = true
  } catch {
    fail('Odmowa: nie udało się atomowo zapisać kompletnego markera pilota.')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (!complete) fail('Odmowa: marker pilota nie został zapisany kompletnie.')
  assertValidPilotMarker(config)
}

function cleanupFreshRoot(root: string, label: string) {
  try {
    assertPrivatePilotRoot(root, label, true)
    rmSync(root, { recursive: true, force: false })
  } catch {
    // Jeśli środowisko uniemożliwiło sprzątanie świeżego katalogu, nie ryzykuj usunięcia innej ścieżki.
  }
}

function createPrivatePilotRoots(config: PilotConfig) {
  let databaseRootCreated = false
  let mediaRootCreated = false
  try {
    createPrivateRoot(config.databaseRoot, 'katalogu bazy danych')
    databaseRootCreated = true
    createPrivateRoot(config.mediaRoot, 'katalogu mediów')
    mediaRootCreated = true
    writeCompleteMarker(config)
    assertPilotRootsPrivate(config, true)
  } catch (error) {
    if (mediaRootCreated) cleanupFreshRoot(config.mediaRoot, 'katalog mediów')
    if (databaseRootCreated) cleanupFreshRoot(config.databaseRoot, 'katalog bazy danych')
    throw error
  }
}

function assertPilotResettable(config: PilotConfig) {
  assertPilotRootsPrivate(config, true)
  assertValidPilotMarker(config)
}

export function validatePilotConfig(input: NodeJS.ProcessEnv, localIpv4Addresses = hostLocalIpv4Addresses()): PilotConfig {
  if (input.NODE_ENV === 'production') fail('Odmowa uruchomienia: NODE_ENV=production nie jest dozwolone dla pilota.')
  const databaseUrl = required(input, 'DATABASE_URL')
  const { databaseRoot, databasePath } = validatePilotDatabase(databaseUrl)
  const mediaRoot = validatePilotMediaRoot(required(input, 'PILOT_MEDIA_ROOT'))
  const { baseUrl, port } = validatePilotBaseUrl(required(input, 'PILOT_BASE_URL'))
  const bindIp = new URL(baseUrl).hostname
  if (!localIpv4Addresses.includes(bindIp)) fail('PILOT_BASE_URL musi wskazywać prywatny IPv4 przypisany do tego hosta.')
  const adminPassword = required(input, 'PILOT_ADMIN_PASSWORD')
  const authSecret = required(input, 'PILOT_AUTH_SECRET')
  if (!isStrongPassword(adminPassword)) fail('PILOT_ADMIN_PASSWORD musi mieć co najmniej 10 znaków oraz małą i wielką literę, cyfrę i znak specjalny.')
  if (!isStrongAuthSecret(authSecret)) fail('PILOT_AUTH_SECRET musi być osobnym, losowym sekretem bez spacji o długości co najmniej 32 znaków.')
  if (adminPassword === authSecret) fail('PILOT_AUTH_SECRET musi być inny niż PILOT_ADMIN_PASSWORD.')

  return {
    baseUrl,
    port,
    databaseUrl,
    databaseRoot,
    databasePath,
    mediaRoot,
    markerPath: path.join(databaseRoot, PILOT_MARKER_FILENAME),
    bindIp,
    adminUsername: ADMIN_USERNAME,
    adminPassword,
    authSecret,
    runtimeEnv: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      DATABASE_URL: databaseUrl,
      NEXTAUTH_URL: baseUrl,
      NEXTAUTH_SECRET: authSecret,
      INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem',
      INSTALLATION_MEDIA_TEST_ROOT: mediaRoot,
    },
  }
}

export function parsePilotCommand(args: string[]): PilotCommand {
  if (args.length === 0) return 'start'
  if (args.length !== 1) fail('Użycie: npm run pilot:installations -- [--check | --reset | --help]')
  if (args[0] === '--check') return 'check'
  if (args[0] === '--reset') return 'reset'
  if (args[0] === '--help' || args[0] === '-h') return 'help'
  fail('Użycie: npm run pilot:installations -- [--check | --reset | --help]')
}

function printSafePilotSummary(config: PilotConfig, print: (line: string) => void) {
  print(`Pilot URL: ${config.baseUrl}`)
  print(`Login: ${config.adminUsername}`)
  print('UWAGA: fikcyjne dane, nie produkcja.')
}

export function attachPilotShutdownHandlers(child: Pick<PilotChild, 'kill'>, signals: SignalSource = process) {
  let forwarded = 0
  const forward = (signal: NodeJS.Signals) => {
    forwarded += 1
    child.kill(forwarded === 1 ? signal : 'SIGTERM')
  }
  const onSigint = () => forward('SIGINT')
  const onSigterm = () => forward('SIGTERM')
  signals.on('SIGINT', onSigint)
  signals.on('SIGTERM', onSigterm)
  return () => {
    signals.removeListener('SIGINT', onSigint)
    signals.removeListener('SIGTERM', onSigterm)
  }
}

function observePilotChild(child: PilotChild, detach: () => void) {
  return new Promise<void>((resolve, reject) => {
    child.once('error', (error) => {
      detach()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      detach()
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') return resolve()
      reject(new Error('Serwer pilota zakończył się nieoczekiwanie.'))
    })
  })
}

export async function runPilot(command: PilotCommand, env: NodeJS.ProcessEnv, dependencies: PilotDependencies) {
  if (command === 'help') {
    dependencies.print(helpText())
    return
  }

  const config = validatePilotConfig(env, dependencies.localIpv4Addresses())
  if (command === 'check') {
    printSafePilotSummary(config, dependencies.print)
    return config
  }
  if (command === 'reset') {
    if (env.PILOT_CONFIRM_RESET !== 'DELETE_PILOT_DATA') fail('Reset wymaga jawnego PILOT_CONFIRM_RESET=DELETE_PILOT_DATA.')
    assertPilotResettable(config)
    dependencies.remove(config)
    dependencies.print('Usunięto wyłącznie wskazane dane pilota.')
    return config
  }

  assertPilotRootsAbsent(config)
  await dependencies.preflightPort(config)
  let migrationStarted = false
  let child: PilotChild | undefined
  let detach: (() => void) | undefined
  try {
    createPrivatePilotRoots(config)
    migrationStarted = true
    await dependencies.migrate(config)
    assertPilotRootsPrivate(config, true)
    await dependencies.seed(config)
    assertPilotRootsPrivate(config, true)
    child = dependencies.start(config)
    detach = attachPilotShutdownHandlers(child)
    const completion = observePilotChild(child, detach)
    let ready = false
    const exitBeforeReady = completion.then(
      () => { if (!ready) fail('Serwer pilota zakończył się przed osiągnięciem gotowości.') },
      (error) => { if (!ready) throw error },
    )
    await Promise.race([dependencies.waitForReady(config, child), exitBeforeReady])
    ready = true
    if (child.exitCode !== null) fail('Serwer pilota zakończył się przed osiągnięciem gotowości.')
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (child.exitCode !== null) fail('Serwer pilota zakończył się przed osiągnięciem gotowości.')
    printSafePilotSummary(config, dependencies.print)
    await completion
  } catch (error) {
    detach?.()
    if (child?.exitCode === null) child.kill('SIGTERM')
    if (migrationStarted) {
      const detail = error instanceof Error ? error.message : 'Nieznany błąd launchera.'
      throw new Error(`${detail} Dane pilota nie zostały automatycznie usunięte; po sprawdzeniu użyj jawnego --reset.`)
    }
    throw error
  }
  return config
}

async function migratePilotDatabase(config: PilotConfig) {
  await runChild(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], config.runtimeEnv, 'Migracje pilota nie powiodły się.')
}

async function seedPilotDatabase(config: PilotConfig) {
  const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } })
  try {
    const passwordHash = await bcrypt.hash(config.adminPassword, 12)
    await db.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { username: config.adminUsername, role: 'ADMIN', passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), isActive: true },
      create: { username: config.adminUsername, email: ADMIN_EMAIL, name: 'Administrator pilota', role: 'ADMIN', passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), isActive: true },
    })
    await db.costCenter.upsert({
      where: { id: 'PILOT' },
      update: { name: 'Dane demonstracyjne pilota', description: 'Wyłącznie fikcyjne dane do testu wewnętrznego.' },
      create: { id: 'PILOT', name: 'Dane demonstracyjne pilota', description: 'Wyłącznie fikcyjne dane do testu wewnętrznego.' },
    })
    await db.employee.upsert({
      where: { email: 'montazysta.pilot@example.test' },
      update: { firstName: 'Marek', lastName: 'Próbny', active: true },
      create: { firstName: 'Marek', lastName: 'Próbny', email: 'montazysta.pilot@example.test', position: 'Monter demonstracyjny', costCenterId: 'PILOT', startDate: new Date('2026-08-01'), active: true },
    })
    await db.employee.upsert({
      where: { email: 'koordynator.pilot@example.test' },
      update: { firstName: 'Anna', lastName: 'Próbna', active: true },
      create: { firstName: 'Anna', lastName: 'Próbna', email: 'koordynator.pilot@example.test', position: 'Koordynatorka demonstracyjna', costCenterId: 'PILOT', startDate: new Date('2026-08-01'), active: true },
    })
  } finally {
    await db.$disconnect()
  }
}

function startPilotServer(config: PilotConfig): PilotChild {
  return spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', config.bindIp, '-p', String(config.port)], {
    cwd: process.cwd(),
    env: config.runtimeEnv,
    stdio: 'ignore',
  })
}

async function waitForPilotReadiness(config: PilotConfig, child: PilotChild) {
  const deadline = Date.now() + 30_000
  const healthUrl = `http://${config.bindIp}:${config.port}/api/health`
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail('Serwer pilota zakończył się przed osiągnięciem gotowości.')
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Next może kompilować pierwszą trasę; ponów w kontrolowanym limicie czasu.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  fail('Serwer pilota nie osiągnął gotowości HTTP w ciągu 30 sekund.')
}

export async function assertPilotPortAvailable(bindIp: string, port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    const failPort = () => reject(new Error('Odmowa: port PILOT_BASE_URL jest już zajęty na tym prywatnym adresie IP.'))
    probe.once('error', failPort)
    probe.listen(port, bindIp, () => {
      probe.removeListener('error', failPort)
      probe.close((error) => error ? reject(new Error('Odmowa: nie można bezpiecznie zwolnić portu pilota.')) : resolve())
    })
  })
}

function runChild(command: string, args: string[], env: NodeJS.ProcessEnv, failureMessage: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'ignore' })
    child.once('error', () => reject(new Error(failureMessage)))
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(failureMessage)))
  })
}

export function removePilotRoots(config: PilotConfig) {
  assertPilotResettable(config)
  rmSync(config.mediaRoot, { recursive: true, force: false })
  rmSync(config.databaseRoot, { recursive: true, force: false })
}

function helpText() {
  return [
    'Użycie:',
    '  PILOT_BASE_URL=http://192.168.1.42:3100 DATABASE_URL=file:/tmp/walldecor-installations-pilot-demo/pilot.db PILOT_MEDIA_ROOT=/tmp/walldecor-installations-e2e-media-pilot-demo PILOT_ADMIN_PASSWORD=... PILOT_AUTH_SECRET=... npm run pilot:installations',
    '',
    'Wymagania: prywatny LAN IPv4 przypisany do hosta i port 1024-65535; hasło admina spełnia politykę aplikacji; osobny sekret ma min. 32 znaki bez spacji.',
    'Start wymaga dwóch świeżych katalogów /tmp: rootu bazy z plikiem pilot.db oraz rootu mediów. Launcher tworzy je atomowo z trybem 0700.',
    'Polecenia: --check sprawdza konfigurację bez migracji i serwera; --reset wymaga PILOT_CONFIRM_RESET=DELETE_PILOT_DATA, poprawnego markera v2 i usuwa wyłącznie oba prywatne rooty.',
    'Po rozpoczęciu migracji dane nie są usuwane automatycznie; nie ma resume, po sprawdzeniu użyj jawnego --reset.',
    'Launcher zawsze wymusza lokalną bazę SQLite, fikcyjny seed oraz filesystemowy adapter mediów w /tmp; upload testuje wyłącznie UX i nie weryfikuje ClamAV ani produkcyjnego przechowywania mediów.',
  ].join('\n')
}

async function main() {
  const command = parsePilotCommand(process.argv.slice(2))
  await runPilot(command, process.env, {
    migrate: migratePilotDatabase,
    seed: seedPilotDatabase,
    start: startPilotServer,
    waitForReady: waitForPilotReadiness,
    preflightPort: (config) => assertPilotPortAvailable(config.bindIp, config.port),
    localIpv4Addresses: hostLocalIpv4Addresses,
    print: (line) => console.log(line),
    remove: removePilotRoots,
  })
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Pilot nie został uruchomiony.')
    process.exitCode = 1
  })
}
