// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  INVOICE_OAUTH_EXPECTED,
  assessInvoiceOAuthEvidence,
  captureSyntheticScreenshot,
  createSyntheticInvoicePng,
  ensureOwnedWorkerStopped,
  invoiceOAuthServerEnvironment,
  invoiceOAuthMultipartPayload,
  invoiceOAuthWorkerArgs,
  loadInvoiceResultSchema,
  parseInvoiceOAuthArgs,
  retainHandledRejection,
} from '../../../scripts/validate-invoice-import-oauth.mjs'

const image = 'sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab'
const oauthVolume = 'wd-ai-oauth-piotr-local-20260911'

describe('invoice import real OAuth acceptance harness', () => {
  it('requires explicit consent, an immutable image id, and an existing named OAuth volume', () => {
    expect(parseInvoiceOAuthArgs([
      '--confirm-synthetic-oauth', '--image', image, '--oauth-volume', oauthVolume,
    ])).toEqual({ image, oauthVolume })

    for (const args of [
      ['--image', image, '--oauth-volume', oauthVolume],
      ['--confirm-synthetic-oauth', '--image', 'latest', '--oauth-volume', oauthVolume],
      ['--confirm-synthetic-oauth', '--image', `sha256:${'a'.repeat(64)}`, '--oauth-volume', oauthVolume],
      ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', '../oauth'],
      ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', 'other-oauth-volume'],
      ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', oauthVolume, '--retry'],
    ]) expect(() => parseInvoiceOAuthArgs(args)).toThrow()
  })

  it('derives one hardened worker with only the three explicit secret-bearing env names', () => {
    const worker = invoiceOAuthWorkerArgs({ image, oauthVolume }, '1720000000000-acde1234')

    expect(worker.name).toBe('wd-ai-oauth-chat-invoice-1720000000000-acde1234')
    expect(worker.args).toContain('--read-only')
    expect(worker.args).toContain('no-new-privileges')
    expect(worker.args).toContain('type=volume,src=wd-ai-oauth-piotr-local-20260911,dst=/oauth')
    expect(worker.args.filter((value) => value === '--env').length).toBe(3)
    expect(worker.args).toEqual(expect.arrayContaining([
      '--env', 'AI_WORKER_ENABLED', '--env', 'AI_WORKER_URL', '--env', 'AI_WORKER_SECRET',
    ]))
    expect(worker.args).not.toContain('/var/run/docker.sock')
    expect(worker.args.at(-2)).toBe(image)
    expect(worker.args.at(-1)).toBe('worker')
  })

  it('positively confirms a clean graceful stop of only the exact owned worker', async () => {
    const docker = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'true 0\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'owned-worker\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'false 0\n' })

    await expect(ensureOwnedWorkerStopped(docker, 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'))
      .resolves.toEqual({ stopped: true, clean: true, forced: false })
    expect(docker.mock.calls.map(([args]) => args)).toEqual([
      ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
      ['stop', '--time', '30', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
      ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
    ])
  })

  it.each([
    ['rejected inspect', new Error('inspect unavailable')],
    ['inspect timeout', new Error('COMMAND_TIMEOUT')],
    ['nonzero inspect', { code: 1, stdout: '' }],
  ])('does not infer stopped from %s and requires a later positive confirmation', async (_label, firstInspect) => {
    const docker = vi.fn()
    if (firstInspect instanceof Error) docker.mockRejectedValueOnce(firstInspect)
    else docker.mockResolvedValueOnce(firstInspect)
    docker
      .mockResolvedValueOnce({ code: 0, stdout: 'owned-worker\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'false 0\n' })

    await expect(ensureOwnedWorkerStopped(docker, 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'))
      .resolves.toEqual({ stopped: true, clean: true, forced: false })
    expect(docker).toHaveBeenCalledTimes(3)
  })

  it('fails closed when stopped state cannot be positively verified', async () => {
    const docker = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'true 0\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'owned-worker\n' })
      .mockRejectedValueOnce(new Error('final inspect unavailable'))
      .mockResolvedValueOnce({ code: 0, stdout: 'owned-worker\n' })
      .mockRejectedValueOnce(new Error('forced final inspect unavailable'))

    await expect(ensureOwnedWorkerStopped(docker, 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'))
      .rejects.toThrow('WORKER_STOP_UNVERIFIED')
    expect(docker).toHaveBeenCalledTimes(5)
  })

  it('force-stops only the exact owned worker after graceful stop failure and reports it unclean', async () => {
    const docker = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'true 0\n' })
      .mockRejectedValueOnce(new Error('stop timeout'))
      .mockResolvedValueOnce({ code: 0, stdout: 'true 0\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'owned-worker\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'false 137\n' })

    await expect(ensureOwnedWorkerStopped(docker, 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'))
      .resolves.toEqual({ stopped: true, clean: false, forced: true })
    expect(docker.mock.calls.map(([args]) => args)).toEqual([
      ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
      ['stop', '--time', '30', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
      ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
      ['kill', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
      ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', 'wd-ai-oauth-chat-invoice-1720000000000-acde1234'],
    ])
  })

  it('handles a signal-stop rejection immediately while retaining it for later catch and final cleanup', () => {
    const moduleUrl = pathToFileURL(path.resolve('scripts/validate-invoice-import-oauth.mjs')).href
    const program = `
      import { retainHandledRejection } from ${JSON.stringify(moduleUrl)}
      let caught = false, uiContinued = false, finalCleanup = false
      const original = retainHandledRejection(new Promise((_, reject) => {
        setTimeout(() => reject(new Error('STOP_UNVERIFIED')), 0)
      }))
      await new Promise((resolve) => setTimeout(resolve, 25))
      try { await original; uiContinued = true }
      catch { caught = true }
      finally { finalCleanup = true }
      process.stdout.write(JSON.stringify({ caught, uiContinued, finalCleanup }))
    `
    const child = spawnSync(process.execPath, [
      '--unhandled-rejections=strict', '--input-type=module', '--eval', program,
    ], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }, encoding: 'utf8', timeout: 10_000 })

    expect({ status: child.status, signal: child.signal, stderr: child.stderr, stdout: child.stdout }).toEqual({
      status: 0,
      signal: null,
      stderr: '',
      stdout: JSON.stringify({ caught: true, uiContinued: false, finalCleanup: true }),
    })
  })

  it('captures a private synthetic failure screenshot through a main-scope helper', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'invoice-oauth-screenshot-test-'))
    const screenshots: string[] = []
    const page = { screenshot: vi.fn(async ({ path: target }: { path: string }) => {
      await import('node:fs/promises').then(({ writeFile }) => writeFile(target, Buffer.from('synthetic screenshot')))
    }) }

    const target = await captureSyntheticScreenshot(page, directory, 'failure-safe-step', screenshots)

    expect(page.screenshot).toHaveBeenCalledWith({ path: target, fullPage: true })
    expect(screenshots).toEqual([target])
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect(retainHandledRejection(Promise.resolve('ok'))).toBeInstanceOf(Promise)
  })

  it('builds a strict allowlisted Next environment without inheriting process env', () => {
    const environment = invoiceOAuthServerEnvironment({
      databaseUrl: 'file:/private/tmp/synthetic.sqlite',
      baseUrl: 'http://127.0.0.1:43123',
      nextAuthSecret: 'n'.repeat(48),
      workerSecret: 'w'.repeat(48),
      originalsDirectory: '/private/tmp/originals',
      processingDirectory: '/private/tmp/processing',
    })

    expect(environment).toEqual({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      NODE_ENV: 'production',
      DATABASE_URL: 'file:/private/tmp/synthetic.sqlite',
      NEXTAUTH_URL: 'http://127.0.0.1:43123',
      NEXTAUTH_SECRET: 'n'.repeat(48),
      AI_WORKER_SECRET: 'w'.repeat(48),
      NEXT_TELEMETRY_DISABLED: '1',
      INVOICE_ORIGINALS_DIR: '/private/tmp/originals',
      INVOICE_PROCESSING_DIR: '/private/tmp/processing',
    })
    expect(environment).not.toHaveProperty('CODEX_HOME')
    expect(environment).not.toHaveProperty('DOCKER_HOST')
  })

  it('builds a real bounded PNG multipart body for denied upload checks', () => {
    const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex')
    const multipart = invoiceOAuthMultipartPayload('batch-synthetic-1', bytes)

    expect(multipart).toEqual({
      batchId: 'batch-synthetic-1',
      file: {
        name: 'denied-synthetic-invoice.png',
        mimeType: 'image/png',
        buffer: bytes,
      },
    })
    expect(() => invoiceOAuthMultipartPayload('', bytes)).toThrow()
    expect(() => invoiceOAuthMultipartPayload('batch-synthetic-1', Buffer.from('not png'))).toThrow()
  })

  it('loads the production invoice schema and rejects missing or wrong OCR facts', async () => {
    const schema = await loadInvoiceResultSchema()
    expect(assessInvoiceOAuthEvidence({ ...INVOICE_OAUTH_EXPECTED, warnings: [] }, schema)).toEqual({
      passed: true,
      checked: INVOICE_OAUTH_EXPECTED,
    })
    expect(assessInvoiceOAuthEvidence({
      ...INVOICE_OAUTH_EXPECTED,
      supplierName: 'SYNTHETIC SUPPLIER POPRAWIONY',
      warnings: [],
    }, schema)).toEqual({ passed: false, code: 'VALUE_MISMATCH' })
    const missingGross = { ...INVOICE_OAUTH_EXPECTED, warnings: [] } as Record<string, unknown>
    delete missingGross.gross
    expect(assessInvoiceOAuthEvidence(missingGross, schema)).toEqual({
      passed: false,
      code: 'INVALID_RESULT_SCHEMA',
    })
  })

  it('renders the visibly synthetic one-page PNG fixture with private file permissions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'invoice-oauth-fixture-test-'))
    const target = path.join(directory, 'synthetic-invoice.png')
    const metadata = await createSyntheticInvoicePng(target)
    const bytes = await readFile(target)

    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(metadata).toMatchObject({ path: target, mimeType: 'image/png' })
    expect(metadata.byteSize).toBe(bytes.byteLength)
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('has no side effects or output when imported', () => {
    const moduleUrl = pathToFileURL(path.resolve('scripts/validate-invoice-import-oauth.mjs')).href
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)})`], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
      encoding: 'utf8',
      timeout: 10_000,
    })

    expect({ status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr }).toEqual({
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    })
  })
})
