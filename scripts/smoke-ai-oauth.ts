/** Synthetic OAuth gate only. Run after dedicated login + Linux proof, under the shared session flock. */
import { chmod, lstat, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'
import { aiChatResultSchema, aiInvoiceResultSchema, aiJobResultJsonSchema, type AiJobKind } from '../src/lib/ai/contracts'
import { CodexRunError, type CodexFailureCode } from '../src/lib/ai/codex-policy'
import { runCodexJob, type CodexJobInput, type CodexRunnerConfig } from '../src/lib/ai/codex-runner'
import { buildAiPrompt, buildWikiContext } from '../src/lib/ai/prompts'

type SmokeCode = CodexFailureCode | 'CONFIRMATION_REQUIRED' | 'INVALID_CONFIG' | 'FIXTURE_ERROR' | 'VALUE_MISMATCH'
type CheckedValues = Record<string, string | number | boolean | null>
type SmokeCheck = { kind: AiJobKind; status: 'PASS'; checked: CheckedValues } | { kind: AiJobKind; status: 'FAIL'; code: SmokeCode }
export interface SyntheticSmokeReport { status: 'PASS' | 'FAIL'; code?: SmokeCode; checks: SmokeCheck[] }
export type SyntheticSmokeDependencies = {
  runJob?: (input: CodexJobInput, config: CodexRunnerConfig) => Promise<unknown>
  writeLine?: (line: string) => void
  signal?: AbortSignal
}
class SmokeError extends Error {
  constructor(readonly code: SmokeCode) { super(code); this.name = 'SyntheticSmokeError' }
}
const RUNNER_CODES = new Set(['AUTH', 'QUOTA', 'MODEL_UNAVAILABLE', 'RUNNER_ERROR', 'INVALID_RESULT', 'TIMEOUT'])
function safeCode(error: unknown): SmokeCode {
  if (error instanceof SmokeError) return error.code
  return error instanceof CodexRunError && RUNNER_CODES.has(error.code) ? error.code : 'RUNNER_ERROR'
}

const INVOICE_EXPECTED = Object.freeze({
  documentType: 'INVOICE', supplierName: 'SYNTHETIC SUPPLIER TEST ONLY', taxId: 'GBTEST0001', invoiceNumber: 'TEST-2026-001',
  issueDate: '2026-01-12', dueDate: '2026-01-26', currency: 'EUR', gross: 123, net: 100, vat: 23, bankAccount: null, paymentStatus: 'UNPAID',
})
const FINANCE_EXPECTED = Object.freeze({ niekompletne: true, przychodyPLN: 1250.5, kosztyPLN: 480.25, wynikPLN: 770.25, brakujacyKanalPLN: null, porownanieRokDoRokuDostepne: false })
const WIKI_EXPECTED = Object.freeze({ czasMinuty: 7, kod: 'TEST-ALFA', kolorOpakowania: null })

async function syntheticInvoicePng(imagePath: string) {
  // All names, identifiers and amounts below are deliberately fictional. No
  // address, real tax identifier, account, customer data or auth file is used.
  const rows = [
    ['FAKTURA TESTOWA - DANE FIKCYJNE', 56, 70, 44],
    ['NIE JEST DOKUMENTEM KSIEGOWYM - SYNTHETIC TEST ONLY', 56, 120, 26],
    ['FAKTURA NR: TEST-2026-001', 56, 220, 38],
    ['Sprzedawca: SYNTHETIC SUPPLIER TEST ONLY', 56, 300, 30],
    ['Identyfikator podatkowy: GBTEST0001 (fikcyjny)', 56, 355, 30],
    ['Nabywca: NABYWCA TESTOWY - FIKCYJNY', 56, 410, 30],
    ['Data wystawienia: 2026-01-12', 56, 495, 32],
    ['Termin platnosci: 2026-01-26', 56, 550, 32],
    ['Pozycja: Fikcyjna probka TEST | Ilosc: 1', 56, 640, 30],
    ['Waluta dokumentu: EUR', 56, 715, 34],
    ['NETTO: 100.00 EUR   VAT 23%: 23.00 EUR', 56, 785, 34],
    ['BRUTTO / DO ZAPLATY: 123.00 EUR', 56, 855, 38],
    ['STATUS PLATNOSCI: NIEZAPLACONA (UNPAID)', 56, 940, 34],
    ['WYLACZNIE TEST SYNTHETYCZNY. Wszystkie dane sa fikcyjne.', 56, 1035, 26],
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1100"><rect width="1400" height="1100" fill="white"/><g font-family="DejaVu Sans" fill="#111">${rows.map(([text, x, y, size]) => `<text x="${x}" y="${y}" font-size="${size}">${text}</text>`).join('')}</g></svg>`
  await sharp(Buffer.from(svg)).png().toFile(imagePath)
  await chmod(imagePath, 0o600)
}

function smokeInputs(imagePath: string): CodexJobInput[] {
  const financeContext = JSON.stringify({
    synthetic: true, notice: 'Wylacznie fikcyjne dane testowe, nie dane firmy.', currency: 'PLN',
    period: { year: 2026, month: 1 }, today: '2026-01-15',
    selected: { revenue: 1250.5, costs: 480.25, result: 770.25, complete: false, partialMonth: true, costsConfirmed: false },
    channels: [{ name: 'Kanal testowy A', amount: 1250.5 }, { name: 'Brakujacy kanal testowy B', amount: null }],
    yoy: null, yoyReason: 'Brak kompletnych i porownywalnych okresow. Porownanie rok do roku jest niedostepne.',
  })
  const wikiContext = buildWikiContext('Fikcyjna procedura TEST-ALFA', 'Syntetyczny test',
    'To wyłącznie fikcyjny artykuł testowy. W procedurze TEST-ALFA odczekaj dokładnie 7 minut. Nie podano koloru opakowania.')
  return [
    { kind: 'INVOICE_EXTRACT', prompt: buildAiPrompt('INVOICE_EXTRACT'), schema: aiJobResultJsonSchema('INVOICE_EXTRACT'), imagePaths: [imagePath] },
    { kind: 'FINANCE_CHAT', schema: aiJobResultJsonSchema('FINANCE_CHAT'), prompt: buildAiPrompt('FINANCE_CHAT', {
      context: financeContext,
      question: 'Zaznacz niekompletność danych. W answer umieść jeden obiekt JSON z polami: niekompletne (boolean), przychodyPLN (liczba zapisana w selected.revenue), kosztyPLN (liczba), wynikPLN (liczba wstępnego wyniku), brakujacyKanalPLN (kwota kanału B, null gdy brak), porownanieRokDoRokuDostepne (boolean). Nie zastępuj braków zerem i nie wyliczaj niedostępnego porównania.',
    }) },
    { kind: 'WIKI_CHAT', schema: aiJobResultJsonSchema('WIKI_CHAT'), prompt: buildAiPrompt('WIKI_CHAT', {
      context: wikiContext,
      question: 'Jakie dane podaje fikcyjny artykuł? W answer umieść jeden obiekt JSON z polami: czasMinuty (liczba), kod (kod procedury), kolorOpakowania (null, jeśli artykuł go nie podaje). Nie dopowiadaj braków.',
    }) },
  ]
}

function validateResult(kind: AiJobKind, raw: unknown): CheckedValues {
  const expected = kind === 'INVOICE_EXTRACT' ? INVOICE_EXPECTED : kind === 'FINANCE_CHAT' ? FINANCE_EXPECTED : WIKI_EXPECTED
  let actual: Record<string, unknown>
  if (kind === 'INVOICE_EXTRACT') {
    const parsed = aiInvoiceResultSchema.safeParse(raw)
    if (!parsed.success) throw new SmokeError('INVALID_RESULT')
    actual = parsed.data
  } else {
    const parsed = aiChatResultSchema.safeParse(raw)
    if (!parsed.success) throw new SmokeError('INVALID_RESULT')
    try {
      const json: unknown = JSON.parse(parsed.data.answer.match(/\{[\s\S]*\}/)?.[0] ?? '')
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error()
      actual = json as Record<string, unknown>
    } catch { throw new SmokeError('INVALID_RESULT') }
  }
  for (const [key, value] of Object.entries(expected)) if (!isDeepStrictEqual(actual[key], value)) throw new SmokeError('VALUE_MISMATCH')
  // Return the verified, fixed synthetic expectations, never arbitrary model text.
  return { ...expected }
}

function runtimeConfig(config: CodexRunnerConfig): CodexRunnerConfig {
  if (![config.binary, config.catalogPath, config.oauthHome, config.workRoot].every((value) => typeof value === 'string' && path.isAbsolute(value)) ||
    (config.sessionLockFd !== undefined && (!Number.isInteger(config.sessionLockFd) || config.sessionLockFd < 3 || config.sessionLockFd > 1024))) throw new SmokeError('INVALID_CONFIG')
  return { binary: config.binary, catalogPath: config.catalogPath, oauthHome: config.oauthHome, workRoot: config.workRoot,
    ...(config.sessionLockFd === undefined ? {} : { sessionLockFd: config.sessionLockFd }), ...(config.signal ? { signal: config.signal } : {}) }
}

export function parseSyntheticOAuthSmokeArgs(args: string[]): CodexRunnerConfig {
  if (!args.includes('--confirm-synthetic-oauth')) throw new SmokeError('CONFIRMATION_REQUIRED')
  const allowed = new Set(['--binary', '--catalog', '--oauth-home', '--work-root', '--session-lock-fd'])
  const values = new Map<string, string>()
  let confirmed = false
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--confirm-synthetic-oauth' && !confirmed) { confirmed = true; continue }
    if (!allowed.has(flag) || values.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new SmokeError('INVALID_CONFIG')
    values.set(flag, args[++i])
  }
  const fd = values.get('--session-lock-fd') ?? ''
  if (!/^\d+$/.test(fd)) throw new SmokeError('INVALID_CONFIG')
  return runtimeConfig({ binary: values.get('--binary') ?? '', catalogPath: values.get('--catalog') ?? '',
    oauthHome: values.get('--oauth-home') ?? '', workRoot: values.get('--work-root') ?? '', sessionLockFd: Number(fd) })
}

/** Unit tests inject runJob; the CLI always uses the pinned production runner, never a provider override. */
export async function runSyntheticOAuthSmoke(config: CodexRunnerConfig, dependencies: SyntheticSmokeDependencies = {}): Promise<SyntheticSmokeReport> {
  const checks: SmokeCheck[] = []
  let report: SyntheticSmokeReport = { status: 'FAIL', checks }
  let fixtureDirectory: string | undefined
  try {
    const runtime = runtimeConfig({ ...config, ...(dependencies.signal ? { signal: dependencies.signal } : {}) })
    if (runtime.signal?.aborted) throw new SmokeError('RUNNER_ERROR')
    try {
      for (const directory of [runtime.oauthHome, runtime.workRoot]) {
        const info = await lstat(directory)
        if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error()
      }
    } catch { throw new SmokeError('INVALID_CONFIG') }
    let imagePath: string
    try {
      fixtureDirectory = await mkdtemp(path.join(runtime.workRoot, 'synthetic-smoke-'))
      imagePath = path.join(fixtureDirectory, 'fictional-invoice.png')
      await syntheticInvoicePng(imagePath)
    } catch { throw new SmokeError('FIXTURE_ERROR') }
    const runJob = dependencies.runJob ?? runCodexJob
    for (const input of smokeInputs(imagePath)) {
      try {
        if (runtime.signal?.aborted) throw new SmokeError('RUNNER_ERROR')
        const result = await runJob(input, runtime)
        if (runtime.signal?.aborted) throw new SmokeError('RUNNER_ERROR')
        checks.push({ kind: input.kind, status: 'PASS', checked: validateResult(input.kind, result) })
      }
      catch (error) { checks.push({ kind: input.kind, status: 'FAIL', code: safeCode(error) }); break }
    }
    report = { status: checks.length === 3 && checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL', checks }
  } catch (error) { report = { status: 'FAIL', code: safeCode(error), checks } }
  finally {
    if (fixtureDirectory) {
      try { await rm(fixtureDirectory, { recursive: true, force: true }) }
      catch { report = { status: 'FAIL', code: 'FIXTURE_ERROR', checks } }
    }
  }
  return report
}

export async function syntheticOAuthSmokeCli(args: string[], dependencies: SyntheticSmokeDependencies = {}): Promise<number> {
  let report: SyntheticSmokeReport
  try { report = await runSyntheticOAuthSmoke(parseSyntheticOAuthSmokeArgs(args), dependencies) }
  catch (error) { report = { status: 'FAIL', code: safeCode(error), checks: [] } }
  const writeLine = dependencies.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`))
  writeLine(JSON.stringify(report))
  return report.status === 'PASS' ? 0 : 1
}

if (process.argv[1]?.endsWith('/smoke-ai-oauth.ts')) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  void syntheticOAuthSmokeCli(process.argv.slice(2), { signal: controller.signal }).then((code) => { process.exitCode = code }).finally(() => {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort)
  })
}
