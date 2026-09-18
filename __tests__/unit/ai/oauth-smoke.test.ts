// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiJobResultJsonSchema } from '@/lib/ai/contracts'
import { CodexRunError } from '@/lib/ai/codex-policy'
import { runCodexJob, type CodexJobInput, type CodexRunnerConfig } from '@/lib/ai/codex-runner'
import { parseSyntheticOAuthSmokeArgs, runSyntheticOAuthSmoke, syntheticOAuthSmokeCli } from '../../../scripts/smoke-ai-oauth'

vi.mock('@/lib/ai/codex-runner', () => ({ runCodexJob: vi.fn().mockRejectedValue(new Error('REAL_OAUTH_RUNNER_FORBIDDEN_IN_UNIT_TESTS')) }))
const invoice = { documentType: 'INVOICE', supplierName: 'SYNTHETIC SUPPLIER TEST ONLY', taxId: 'GBTEST0001', invoiceNumber: 'TEST-2026-001',
  issueDate: '2026-01-12', dueDate: '2026-01-26', currency: 'EUR', gross: 123, net: 100, vat: 23, bankAccount: null, paymentStatus: 'UNPAID', warnings: ['Synthetic fixture'] }
const finance = { niekompletne: true, przychodyPLN: 1250.5, kosztyPLN: 480.25, wynikPLN: 770.25, brakujacyKanalPLN: null, porownanieRokDoRokuDostepne: false }
const wiki = { czasMinuty: 7, kod: 'TEST-ALFA', kolorOpakowania: null }
const output = (kind: CodexJobInput['kind']) => kind === 'INVOICE_EXTRACT' ? invoice : { answer: JSON.stringify(kind === 'FINANCE_CHAT' ? finance : wiki) }
let directory: string
let config: CodexRunnerConfig
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'synthetic-oauth-smoke-test-'))
  config = { binary: path.join(directory, 'not-real-codex'), catalogPath: path.join(directory, 'not-real-catalog.json'), oauthHome: path.join(directory, 'oauth'), workRoot: path.join(directory, 'work'), sessionLockFd: 9 }
  await mkdir(config.oauthHome, { mode: 0o700 })
  await mkdir(config.workRoot, { mode: 0o700 })
  await writeFile(path.join(config.oauthHome, 'synthetic-sentinel'), 'DO_NOT_COPY_OR_READ')
  vi.clearAllMocks()
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const argsFor = () => ['--confirm-synthetic-oauth', '--binary', config.binary, '--catalog', config.catalogPath, '--oauth-home', config.oauthHome, '--work-root', config.workRoot, '--session-lock-fd', '9']

describe('synthetic OAuth smoke preparation', () => {
  it('requires explicit confirmation and all private runtime flags including the inherited lock FD', () => {
    expect(() => parseSyntheticOAuthSmokeArgs(argsFor().slice(1))).toThrow('CONFIRMATION_REQUIRED')
    expect(() => parseSyntheticOAuthSmokeArgs(['--confirm-synthetic-oauth'])).toThrow('INVALID_CONFIG')
    expect(() => parseSyntheticOAuthSmokeArgs(argsFor().slice(0, -2))).toThrow('INVALID_CONFIG')
    expect(parseSyntheticOAuthSmokeArgs(argsFor())).toEqual(config)
    expect(runCodexJob).not.toHaveBeenCalled()
  })

  it('rejects provider/model overrides, repeated options, relative runtime paths and invalid lock descriptors', () => {
    for (const extra of [['--model', 'other'], ['--provider', 'other'], ['--binary', '/duplicate']]) {
      expect(() => parseSyntheticOAuthSmokeArgs([...argsFor(), ...extra])).toThrow('INVALID_CONFIG')
    }
    const relative = argsFor(); relative[2] = 'relative-codex'
    expect(() => parseSyntheticOAuthSmokeArgs(relative)).toThrow('INVALID_CONFIG')
    const invalidFd = argsFor(); invalidFd[invalidFd.length - 1] = '2'
    expect(() => parseSyntheticOAuthSmokeArgs(invalidFd)).toThrow('INVALID_CONFIG')
  })

  it('runs exactly invoice, finance and wiki sequentially using pinned prompts/schema and a real synthetic PNG', async () => {
    const seen: CodexJobInput[] = []
    let active = 0, maxActive = 0
    const runJob = vi.fn(async (input: CodexJobInput, runtime: CodexRunnerConfig) => {
      seen.push(input); active++; maxActive = Math.max(maxActive, active)
      expect(runtime).toEqual(config)
      expect(input.schema).toEqual(aiJobResultJsonSchema(input.kind))
      if (input.kind === 'INVOICE_EXTRACT') {
        expect(input.imagePaths).toHaveLength(1)
        const imagePath = input.imagePaths![0]
        const metadata = await sharp(imagePath).metadata()
        expect(metadata).toMatchObject({ format: 'png', width: 1400, height: 1100 })
        const pixels = await sharp(imagePath).stats()
        expect(pixels.channels.some((channel) => channel.min !== channel.max)).toBe(true)
        expect((await stat(imagePath)).mode & 0o777).toBe(0o600)
        expect(imagePath.startsWith(config.workRoot + path.sep)).toBe(true)
      } else expect(input.imagePaths).toBeUndefined()
      await new Promise<void>((resolve) => setImmediate(resolve))
      active--
      return output(input.kind)
    })
    const result = await runSyntheticOAuthSmoke(config, { runJob })
    expect(result.status).toBe('PASS')
    expect(seen.map((input) => input.kind)).toEqual(['INVOICE_EXTRACT', 'FINANCE_CHAT', 'WIKI_CHAT'])
    expect(maxActive).toBe(1)
    expect(seen.every((input) => input.prompt.includes('Nie masz narzędzi'))).toBe(true)
    expect(seen[1].prompt).toContain('brakujacyKanalPLN')
    expect(seen[1].prompt).toContain('false')
    expect(seen[2].prompt).toContain('TEST-ALFA')
    expect(result.checks[0]).toMatchObject({ status: 'PASS', checked: { currency: 'EUR', gross: 123, bankAccount: null } })
    expect(result.checks[1]).toMatchObject({ status: 'PASS', checked: finance })
    expect(result.checks[2]).toMatchObject({ status: 'PASS', checked: wiki })
    expect(await readdir(config.workRoot)).toEqual([])
    expect(await readFile(path.join(config.oauthHome, 'synthetic-sentinel'), 'utf8')).toBe('DO_NOT_COPY_OR_READ')
    expect(runCodexJob).not.toHaveBeenCalled()
  })

  it('accepts measurable chat data embedded in explanatory prose without exact prose matching', async () => {
    const runJob = vi.fn(async (input: CodexJobInput) => input.kind === 'INVOICE_EXTRACT' ? invoice : { answer: `Dane testowe, niekompletne.\n\`\`\`json\n${JSON.stringify(input.kind === 'FINANCE_CHAT' ? finance : wiki)}\n\`\`\`` })
    expect((await runSyntheticOAuthSmoke(config, { runJob })).status).toBe('PASS')
  })

  it.each([
    ['INVOICE_EXTRACT', { ...invoice, gross: 124 }],
    ['INVOICE_EXTRACT', { ...invoice, bankAccount: 'INVENTED' }],
    ['FINANCE_CHAT', { answer: JSON.stringify({ ...finance, brakujacyKanalPLN: 0 }) }],
    ['FINANCE_CHAT', { answer: JSON.stringify({ ...finance, niekompletne: false }) }],
    ['WIKI_CHAT', { answer: JSON.stringify({ ...wiki, kolorOpakowania: 'blue' }) }],
  ] as const)('fails on incorrect measurable data in %s and exposes no raw answer', async (kind, wrong) => {
    const runJob = vi.fn(async (input: CodexJobInput) => input.kind === kind ? wrong : output(input.kind))
    const result = await runSyntheticOAuthSmoke(config, { runJob })
    expect(result.status).toBe('FAIL')
    expect(result.checks.at(-1)).toMatchObject({ kind, status: 'FAIL', code: 'VALUE_MISMATCH' })
    expect(JSON.stringify(result)).not.toContain('INVENTED')
    expect(JSON.stringify(result)).not.toContain('blue')
    expect(await readdir(config.workRoot)).toEqual([])
  })

  it('rejects malformed structured output rather than accepting a success-shaped object', async () => {
    const runJob = vi.fn().mockResolvedValue({ ...invoice, gross: '123' })
    const result = await runSyntheticOAuthSmoke(config, { runJob })
    expect(result.checks).toEqual([{ kind: 'INVOICE_EXTRACT', status: 'FAIL', code: 'INVALID_RESULT' }])
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it.each([new CodexRunError('AUTH'), new CodexRunError('QUOTA'), new CodexRunError('MODEL_UNAVAILABLE'), new Error('SECRET_RAW_PROMPT_AND_OAUTH_LOG')])('stops on the first runner failure and emits only a controlled code', async (error) => {
    const runJob = vi.fn().mockRejectedValue(error)
    const result = await runSyntheticOAuthSmoke(config, { runJob })
    expect(result.status).toBe('FAIL')
    expect(result.checks).toEqual([{ kind: 'INVOICE_EXTRACT', status: 'FAIL', code: error instanceof CodexRunError ? error.code : 'RUNNER_ERROR' }])
    expect(JSON.stringify(result)).not.toMatch(/SECRET_RAW|Prepared|oauth|prompt/)
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(await readdir(config.workRoot)).toEqual([])
  })

  it('requires private runtime directories and never mutates OAuth storage or unrelated work files', async () => {
    const runJob = vi.fn(async (input: CodexJobInput) => output(input.kind))
    await writeFile(path.join(config.workRoot, 'keep-me'), 'PRESERVE')
    await chmod(config.oauthHome, 0o755)
    expect(await runSyntheticOAuthSmoke(config, { runJob })).toMatchObject({ status: 'FAIL', code: 'INVALID_CONFIG' })
    expect(runJob).not.toHaveBeenCalled()
    expect(await readFile(path.join(config.workRoot, 'keep-me'), 'utf8')).toBe('PRESERVE')
    expect(await readFile(path.join(config.oauthHome, 'synthetic-sentinel'), 'utf8')).toBe('DO_NOT_COPY_OR_READ')
  })

  it('CLI refuses missing confirmation without calling either injected or real runtime', async () => {
    const writeLine = vi.fn()
    const runJob = vi.fn(async (input: CodexJobInput) => output(input.kind))
    expect(await syntheticOAuthSmokeCli([], { runJob, writeLine })).toBe(1)
    expect(writeLine).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ status: 'FAIL', code: 'CONFIRMATION_REQUIRED', checks: [] }))
    expect(runJob).not.toHaveBeenCalled()
    expect(runCodexJob).not.toHaveBeenCalled()
  })

  it('CLI emits only one sanitized PASS report with synthetic values when the injected runtime passes', async () => {
    const writeLine = vi.fn()
    const runJob = vi.fn(async (input: CodexJobInput) => output(input.kind))
    expect(await syntheticOAuthSmokeCli(argsFor(), { runJob, writeLine })).toBe(0)
    expect(writeLine).toHaveBeenCalledTimes(1)
    expect(JSON.parse(writeLine.mock.calls[0][0])).toMatchObject({ status: 'PASS', checks: [{ kind: 'INVOICE_EXTRACT' }, { kind: 'FINANCE_CHAT' }, { kind: 'WIKI_CHAT' }] })
    expect(writeLine.mock.calls[0][0]).not.toContain(directory)
    expect(writeLine.mock.calls[0][0]).not.toMatch(/DO_NOT_COPY|warnings|answer|prompt/)
    expect(runCodexJob).not.toHaveBeenCalled()
  })

  it('does not call a runner for an already-aborted smoke invocation', async () => {
    const abort = new AbortController()
    abort.abort(new Error('PRIVATE_ABORT_REASON'))
    const runJob = vi.fn(async (input: CodexJobInput) => output(input.kind))
    expect(await runSyntheticOAuthSmoke(config, { runJob, signal: abort.signal })).toMatchObject({ status: 'FAIL', code: 'RUNNER_ERROR', checks: [] })
    expect(runJob).not.toHaveBeenCalled()
    expect(await readdir(config.workRoot)).toEqual([])
  })

  it('stops before the next synthetic job if abort arrives during an injected runner call', async () => {
    const abort = new AbortController()
    const runJob = vi.fn(async () => { abort.abort(new Error('PRIVATE_ABORT_REASON')); return invoice })
    const report = await runSyntheticOAuthSmoke(config, { runJob, signal: abort.signal })
    expect(report).toMatchObject({ status: 'FAIL', checks: [{ kind: 'INVOICE_EXTRACT', status: 'FAIL', code: 'RUNNER_ERROR' }] })
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(report)).not.toContain('PRIVATE_ABORT_REASON')
  })
})
