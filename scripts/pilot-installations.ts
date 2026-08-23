import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'
import { isStrongPassword } from '../src/lib/accounts/policy'

const PILOT_DATABASE_PATTERN = /^\/tmp\/walldecor-installations-pilot-[A-Za-z0-9][A-Za-z0-9._-]*\.db$/
const PILOT_MEDIA_PATTERN = /^\/tmp\/walldecor-installations-e2e-media-pilot-[A-Za-z0-9][A-Za-z0-9._-]*$/
const ADMIN_USERNAME = 'pilotadmin'
const ADMIN_EMAIL = 'pilot-admin@example.test'

export type PilotCommand = 'start' | 'check' | 'reset' | 'help'

export interface PilotConfig {
  baseUrl: string
  port: number
  databaseUrl: string
  databasePath: string
  mediaRoot: string
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
  print(line: string): void
  remove(targets: string[]): void
}

interface SignalSource {
  once(event: NodeJS.Signals, listener: () => void): unknown
  removeListener(event: NodeJS.Signals, listener: () => void): unknown
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
    fail('DATABASE_URL pilota musi być adresem SQLite file:/tmp/...db.')
  }

  if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) {
    fail('DATABASE_URL pilota musi być czystym adresem SQLite file:/tmp/...db.')
  }

  const databasePath = fileURLToPath(parsed)
  if (!PILOT_DATABASE_PATTERN.test(databasePath)) {
    fail('DATABASE_URL może wskazywać wyłącznie izolowaną bazę /tmp/walldecor-installations-pilot-*.db.')
  }

  return databasePath
}

function validatePilotMediaRoot(value: string) {
  const mediaRoot = path.resolve(value)
  if (!PILOT_MEDIA_PATTERN.test(mediaRoot)) {
    fail('PILOT_MEDIA_ROOT może wskazywać wyłącznie /tmp/walldecor-installations-e2e-media-pilot-*.')
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

export function validatePilotConfig(input: NodeJS.ProcessEnv): PilotConfig {
  if (input.NODE_ENV === 'production') {
    fail('Odmowa uruchomienia: NODE_ENV=production nie jest dozwolone dla pilota.')
  }

  const databaseUrl = required(input, 'DATABASE_URL')
  const databasePath = validatePilotDatabase(databaseUrl)
  const mediaRoot = validatePilotMediaRoot(required(input, 'PILOT_MEDIA_ROOT'))
  const { baseUrl, port } = validatePilotBaseUrl(required(input, 'PILOT_BASE_URL'))
  const adminPassword = required(input, 'PILOT_ADMIN_PASSWORD')
  const authSecret = required(input, 'PILOT_AUTH_SECRET')

  if (!isStrongPassword(adminPassword)) {
    fail('PILOT_ADMIN_PASSWORD musi mieć co najmniej 10 znaków oraz małą i wielką literę, cyfrę i znak specjalny.')
  }
  if (!isStrongAuthSecret(authSecret)) {
    fail('PILOT_AUTH_SECRET musi być osobnym, losowym sekretem bez spacji o długości co najmniej 32 znaków.')
  }
  if (adminPassword === authSecret) {
    fail('PILOT_AUTH_SECRET musi być inny niż PILOT_ADMIN_PASSWORD.')
  }

  return {
    baseUrl,
    port,
    databaseUrl,
    databasePath,
    mediaRoot,
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

export function pilotResetTargets(config: PilotConfig) {
  return [
    config.databasePath,
    `${config.databasePath}-journal`,
    `${config.databasePath}-shm`,
    `${config.databasePath}-wal`,
    config.mediaRoot,
  ]
}

function printSafePilotSummary(config: PilotConfig, print: (line: string) => void) {
  print(`Pilot URL: ${config.baseUrl}`)
  print(`Login: ${config.adminUsername}`)
  print('UWAGA: fikcyjne dane, nie produkcja.')
}

export function attachPilotShutdownHandlers(child: Pick<PilotChild, 'kill'>, signals: SignalSource = process) {
  let forwarded = false
  const forward = (signal: NodeJS.Signals) => {
    if (forwarded) return
    forwarded = true
    child.kill(signal)
  }
  const onSigint = () => forward('SIGINT')
  const onSigterm = () => forward('SIGTERM')
  signals.once('SIGINT', onSigint)
  signals.once('SIGTERM', onSigterm)
  return () => {
    signals.removeListener('SIGINT', onSigint)
    signals.removeListener('SIGTERM', onSigterm)
  }
}

function awaitPilotChild(child: PilotChild, detach: () => void) {
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

  const config = validatePilotConfig(env)
  if (command === 'check') {
    printSafePilotSummary(config, dependencies.print)
    return config
  }

  if (command === 'reset') {
    if (env.PILOT_CONFIRM_RESET !== 'DELETE_PILOT_DATA') {
      fail('Reset wymaga jawnego PILOT_CONFIRM_RESET=DELETE_PILOT_DATA.')
    }
    dependencies.remove(pilotResetTargets(config))
    dependencies.print('Usunięto wyłącznie wskazane dane pilota.')
    return config
  }

  mkdirSync(config.mediaRoot, { recursive: true })
  await dependencies.migrate(config)
  await dependencies.seed(config)
  const child = dependencies.start(config)
  const detach = attachPilotShutdownHandlers(child)
  try {
    await dependencies.waitForReady(config, child)
    printSafePilotSummary(config, dependencies.print)
    await awaitPilotChild(child, detach)
  } catch (error) {
    detach()
    if (child.exitCode === null) child.kill('SIGTERM')
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
  return spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '0.0.0.0', '-p', String(config.port)], {
    cwd: process.cwd(),
    env: config.runtimeEnv,
    stdio: 'ignore',
  })
}

async function waitForPilotReadiness(config: PilotConfig, child: PilotChild) {
  const deadline = Date.now() + 30_000
  const healthUrl = `http://127.0.0.1:${config.port}/api/health`

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail('Serwer pilota zakończył się przed osiągnięciem gotowości.')
    }
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

function runChild(command: string, args: string[], env: NodeJS.ProcessEnv, failureMessage: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'ignore' })
    child.once('error', () => reject(new Error(failureMessage)))
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(failureMessage)))
  })
}

function removePilotTargets(targets: string[]) {
  for (const target of targets) {
    if (PILOT_DATABASE_PATTERN.test(target)) {
      rmSync(target, { force: true })
      continue
    }
    if (/^\/tmp\/walldecor-installations-pilot-[A-Za-z0-9][A-Za-z0-9._-]*\.db-(journal|shm|wal)$/.test(target)) {
      rmSync(target, { force: true })
      continue
    }
    if (PILOT_MEDIA_PATTERN.test(target)) {
      rmSync(target, { recursive: true, force: true })
      continue
    }
    fail('Odmowa resetu: wykryto ścieżkę spoza pilota.')
  }
}

function helpText() {
  return [
    'Użycie:',
    '  PILOT_BASE_URL=http://192.168.1.42:3100 DATABASE_URL=file:/tmp/walldecor-installations-pilot-demo.db PILOT_MEDIA_ROOT=/tmp/walldecor-installations-e2e-media-pilot-demo PILOT_ADMIN_PASSWORD=... PILOT_AUTH_SECRET=... npm run pilot:installations',
    '',
    'Wymagania: prywatny LAN IPv4 i port 1024-65535; hasło admina spełnia politykę aplikacji; osobny sekret ma min. 32 znaki bez spacji.',
    'Polecenia: --check sprawdza konfigurację bez migracji i serwera; --reset wymaga PILOT_CONFIRM_RESET=DELETE_PILOT_DATA i usuwa wyłącznie zwalidowane ścieżki pilota.',
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
    print: (line) => console.log(line),
    remove: removePilotTargets,
  })
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Pilot nie został uruchomiony.')
    process.exitCode = 1
  })
}
