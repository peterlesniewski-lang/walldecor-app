import { EventEmitter } from 'node:events'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  assertPilotPortAvailable,
  attachPilotShutdownHandlers,
  parsePilotCommand,
  runPilot,
  validatePilotConfig,
} from '../../../scripts/pilot-installations'

const localIpv4Addresses = () => ['192.168.1.42']

const safeEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'file:/tmp/walldecor-installations-pilot-demo.db',
  PILOT_MEDIA_ROOT: '/tmp/walldecor-installations-e2e-media-pilot-demo',
  PILOT_BASE_URL: 'http://192.168.1.42:3100',
  PILOT_ADMIN_PASSWORD: 'PilotOnly-Password9!',
  PILOT_AUTH_SECRET: 'pilot-auth-secret-that-is-long-and-unique-2026',
}

function isolatedPilotPaths() {
  const suffix = randomUUID()
  const outsideDirectory = mkdtempSync('/tmp/walldecor-installations-pilot-outside-')
  return {
    outsideDirectory,
    databasePath: path.join('/tmp', `walldecor-installations-pilot-fs-${suffix}.db`),
    mediaRoot: path.join('/tmp', `walldecor-installations-e2e-media-pilot-fs-${suffix}`),
  }
}

function pilotEnv(paths: ReturnType<typeof isolatedPilotPaths>) {
  return {
    ...safeEnv,
    DATABASE_URL: `file:${paths.databasePath}`,
    PILOT_MEDIA_ROOT: paths.mediaRoot,
  }
}

function markerContent(paths: ReturnType<typeof isolatedPilotPaths>) {
  return `${JSON.stringify({ version: 1, databasePath: paths.databasePath, mediaRoot: paths.mediaRoot, bindIp: '192.168.1.42', port: 3100 })}\n`
}

function cleanupPilotPaths(paths: ReturnType<typeof isolatedPilotPaths>) {
  for (const target of [
    paths.databasePath,
    `${paths.databasePath}-journal`,
    `${paths.databasePath}-shm`,
    `${paths.databasePath}-wal`,
    `${paths.databasePath}.pilot01.marker`,
    paths.mediaRoot,
  ]) rmSync(target, { recursive: target === paths.mediaRoot, force: true })
  rmSync(paths.outsideDirectory, { recursive: true, force: true })
}

function unsafeStartDependencies() {
  return {
    migrate: vi.fn(),
    seed: vi.fn(),
    start: vi.fn(),
    waitForReady: vi.fn(),
    preflightPort: vi.fn(async () => undefined),
    localIpv4Addresses,
    print: vi.fn(),
    remove: vi.fn(),
  }
}

describe('installations pilot launcher', () => {
  it('refuses production before it can create a pilot configuration', () => {
    expect(() => validatePilotConfig({ ...safeEnv, NODE_ENV: 'production' }, localIpv4Addresses())).toThrow('NODE_ENV=production')
  })

  it.each([
    ['a database outside the pilot prefix', { DATABASE_URL: 'file:/tmp/walldecor.db' }],
    ['a media root outside the pilot prefix', { PILOT_MEDIA_ROOT: '/tmp/walldecor-installations-e2e-media-shared' }],
    ['localhost as the phone-facing URL', { PILOT_BASE_URL: 'http://localhost:3100' }],
    ['a public host as the phone-facing URL', { PILOT_BASE_URL: 'http://203.0.113.9:3100' }],
    ['HTTPS as the phone-facing URL', { PILOT_BASE_URL: 'https://192.168.1.42:3100' }],
    ['a weak administrator password', { PILOT_ADMIN_PASSWORD: 'weak' }],
    ['a short auth secret', { PILOT_AUTH_SECRET: 'short' }],
    ['an auth secret reused as the administrator password', { PILOT_AUTH_SECRET: safeEnv.PILOT_ADMIN_PASSWORD }],
  ])('refuses %s', (_label, override) => {
    expect(() => validatePilotConfig({ ...safeEnv, ...override }, localIpv4Addresses())).toThrow()
  })

  it('maps only validated pilot values into the runtime environment', () => {
    const config = validatePilotConfig(safeEnv, localIpv4Addresses())

    expect(config).toMatchObject({
      baseUrl: 'http://192.168.1.42:3100',
      port: 3100,
      databasePath: '/tmp/walldecor-installations-pilot-demo.db',
      mediaRoot: '/tmp/walldecor-installations-e2e-media-pilot-demo',
      bindIp: '192.168.1.42',
      adminUsername: 'pilotadmin',
    })
    expect(config.runtimeEnv).toMatchObject({
      NODE_ENV: 'development',
      DATABASE_URL: safeEnv.DATABASE_URL,
      NEXTAUTH_URL: safeEnv.PILOT_BASE_URL,
      INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem',
      INSTALLATION_MEDIA_TEST_ROOT: safeEnv.PILOT_MEDIA_ROOT,
    })
    expect(config.runtimeEnv.NEXTAUTH_SECRET).toBe(safeEnv.PILOT_AUTH_SECRET)
  })

  it('refuses a private URL address that is not assigned to this host', () => {
    expect(() => validatePilotConfig(safeEnv, [])).toThrow('przypisany do tego hosta')
  })

  it('rejects an occupied port on the exact requested interface', async () => {
    const listener = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        listener.once('error', onError)
        listener.listen(0, '127.0.0.1', () => {
          listener.removeListener('error', onError)
          resolve()
        })
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    const address = listener.address()
    if (!address || typeof address === 'string') throw new Error('test listener did not expose a TCP port')
    try {
      await expect(assertPilotPortAvailable('127.0.0.1', address.port)).rejects.toThrow('PILOT_BASE_URL')
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('parses check and reset as explicit non-server commands', () => {
    expect(parsePilotCommand(['--check'])).toBe('check')
    expect(parsePilotCommand(['--reset'])).toBe('reset')
    expect(parsePilotCommand([])).toBe('start')
    expect(() => parsePilotCommand(['--check', '--reset'])).toThrow('Użycie')
  })

  it('checks configuration without migrating, seeding, or starting Next', async () => {
    const migrate = vi.fn()
    const seed = vi.fn()
    const start = vi.fn()
    const print = vi.fn()

    await runPilot('check', safeEnv, { migrate, seed, start, waitForReady: vi.fn(), preflightPort: vi.fn(), localIpv4Addresses, print, remove: vi.fn() })

    expect(migrate).not.toHaveBeenCalled()
    expect(seed).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    const output = print.mock.calls.flat().join('\n')
    expect(output).toContain(safeEnv.PILOT_BASE_URL)
    expect(output).toContain('pilotadmin')
    expect(output).not.toContain(safeEnv.PILOT_ADMIN_PASSWORD)
    expect(output).not.toContain(safeEnv.PILOT_AUTH_SECRET)
  })

  it.each([
    ['a database symlink', (paths: ReturnType<typeof isolatedPilotPaths>) => {
      const outside = path.join(paths.outsideDirectory, 'outside.db')
      writeFileSync(outside, 'outside')
      symlinkSync(outside, paths.databasePath)
    }],
    ['a media-root symlink', (paths: ReturnType<typeof isolatedPilotPaths>) => {
      const outside = path.join(paths.outsideDirectory, 'media')
      rmSync(outside, { force: true })
      symlinkSync(paths.outsideDirectory, paths.mediaRoot)
    }],
    ['a database hardlink', (paths: ReturnType<typeof isolatedPilotPaths>) => {
      const outside = path.join(paths.outsideDirectory, 'outside.db')
      writeFileSync(outside, 'outside')
      linkSync(outside, paths.databasePath)
    }],
  ])('refuses %s before any pilot mutation', async (_label, createUnsafePath) => {
    const paths = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      createUnsafePath(paths)
      const env = pilotEnv(paths)

      await expect(runPilot('start', env, dependencies)).rejects.toThrow('Odmowa')

      expect(dependencies.migrate).not.toHaveBeenCalled()
      expect(dependencies.seed).not.toHaveBeenCalled()
      expect(dependencies.start).not.toHaveBeenCalled()
      expect(dependencies.remove).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('refuses unsafe pilot paths before reset can remove anything', async () => {
    const paths = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      const outside = path.join(paths.outsideDirectory, 'outside.db')
      writeFileSync(outside, 'outside')
      symlinkSync(outside, paths.databasePath)
      const env = { ...pilotEnv(paths), PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }

      await expect(runPilot('reset', env, dependencies)).rejects.toThrow('Odmowa')

      expect(dependencies.remove).not.toHaveBeenCalled()
      expect(dependencies.migrate).not.toHaveBeenCalled()
      expect(dependencies.seed).not.toHaveBeenCalled()
      expect(dependencies.start).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('refuses a reset that mixes a valid marker from another pilot media root', async () => {
    const first = isolatedPilotPaths()
    const second = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      writeFileSync(`${first.databasePath}.pilot01.marker`, markerContent(first))
      mkdirSync(second.mediaRoot)
      const mixedEnv = { ...pilotEnv(first), PILOT_MEDIA_ROOT: second.mediaRoot, PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }

      await expect(runPilot('reset', mixedEnv, dependencies)).rejects.toThrow('nie należy do wskazanego pilota')

      expect(dependencies.remove).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(first)
      cleanupPilotPaths(second)
    }
  })

  it.each([
    ['database', (paths: ReturnType<typeof isolatedPilotPaths>) => writeFileSync(paths.databasePath, 'already used')],
    ['SQLite sidecar', (paths: ReturnType<typeof isolatedPilotPaths>) => writeFileSync(`${paths.databasePath}-wal`, 'already used')],
    ['media root', (paths: ReturnType<typeof isolatedPilotPaths>) => writeFileSync(paths.mediaRoot, 'already used')],
    ['marker', (paths: ReturnType<typeof isolatedPilotPaths>) => writeFileSync(`${paths.databasePath}.pilot01.marker`, 'already used')],
  ])('requires an unused %s before port preflight', async (_label, createExistingPath) => {
    const paths = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      createExistingPath(paths)

      await expect(runPilot('start', pilotEnv(paths), dependencies)).rejects.toThrow('już istnieje')

      expect(dependencies.preflightPort).not.toHaveBeenCalled()
      expect(dependencies.migrate).not.toHaveBeenCalled()
      expect(dependencies.seed).not.toHaveBeenCalled()
      expect(dependencies.start).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('waits for the local health endpoint before printing the usable pilot URL', async () => {
    const paths = isolatedPilotPaths()
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null })
    const sequence: string[] = []
    const dependencies = {
      migrate: vi.fn(async () => { writeFileSync(paths.databasePath, ''); sequence.push('migrate') }),
      seed: vi.fn(async () => { sequence.push('seed') }),
      start: vi.fn(() => child),
      waitForReady: vi.fn(async () => {
        sequence.push('ready')
        setTimeout(() => child.emit('exit', 0, null), 0)
      }),
      preflightPort: vi.fn(async () => undefined),
      localIpv4Addresses,
      print: vi.fn(() => { sequence.push('print') }),
      remove: vi.fn(),
    }

    try {
      await runPilot('start', pilotEnv(paths), dependencies)
      expect(sequence).toEqual(['migrate', 'seed', 'ready', 'print', 'print', 'print'])
      expect(dependencies.waitForReady).toHaveBeenCalledWith(expect.objectContaining({ port: 3100 }), child)
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('fails promptly when the child exits synchronously during readiness', async () => {
    const paths = isolatedPilotPaths()
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null as number | null })
    const neverReady = new Promise<void>(() => {})
    const dependencies = {
      migrate: vi.fn(async () => { writeFileSync(paths.databasePath, '') }),
      seed: vi.fn(async () => undefined),
      start: vi.fn(() => child),
      waitForReady: vi.fn(() => {
        child.exitCode = 1
        child.emit('exit', 1, null)
        return neverReady
      }),
      preflightPort: vi.fn(async () => undefined),
      localIpv4Addresses,
      print: vi.fn(),
      remove: vi.fn(),
    }
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('test timeout')), 250))

    try {
      await expect(Promise.race([runPilot('start', pilotEnv(paths), dependencies), timeout])).rejects.toThrow('Serwer pilota zakończył się')
      expect(dependencies.print).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('labels the filesystem adapter as a UX-only upload test, not production media protection', async () => {
    const print = vi.fn()

    await runPilot('help', {}, { migrate: vi.fn(), seed: vi.fn(), start: vi.fn(), waitForReady: vi.fn(), preflightPort: vi.fn(), localIpv4Addresses, print, remove: vi.fn() })

    expect(print.mock.calls.flat().join('\n')).toContain('nie weryfikuje ClamAV')
  })

  it('requires an explicit confirmation before deleting validated pilot paths', async () => {
    const remove = vi.fn()

    await expect(runPilot('reset', safeEnv, { migrate: vi.fn(), seed: vi.fn(), start: vi.fn(), waitForReady: vi.fn(), preflightPort: vi.fn(), localIpv4Addresses, print: vi.fn(), remove })).rejects.toThrow('PILOT_CONFIRM_RESET')
    expect(remove).not.toHaveBeenCalled()

    const paths = isolatedPilotPaths()
    const env = { ...pilotEnv(paths), PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }
    try {
      writeFileSync(`${paths.databasePath}.pilot01.marker`, markerContent(paths))
      await runPilot('reset', env, { migrate: vi.fn(), seed: vi.fn(), start: vi.fn(), waitForReady: vi.fn(), preflightPort: vi.fn(), localIpv4Addresses, print: vi.fn(), remove })
      expect(remove).toHaveBeenCalledWith(expect.objectContaining({ markerPath: `${paths.databasePath}.pilot01.marker` }))
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('escalates a repeated shutdown signal to the Next child without deleting pilot data', () => {
    const signals = new EventEmitter()
    const child = { kill: vi.fn() }
    const detach = attachPilotShutdownHandlers(child, signals)

    signals.emit('SIGINT')
    signals.emit('SIGTERM')

    expect(child.kill).toHaveBeenCalledTimes(2)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    detach()
  })
})
