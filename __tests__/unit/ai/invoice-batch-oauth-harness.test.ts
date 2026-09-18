// @vitest-environment node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { aiInvoiceResultSchema } from '@/lib/ai/contracts'

// Missing implementation must fail an assertion, not test-file collection.
type Gate = typeof import('../../../scripts/validate-invoice-batch-oauth.mjs')
type GateFunction = Exclude<keyof Gate, 'INVOICE_BATCH_LIMITS'>
const gate: Partial<Gate> = await import('../../../scripts/validate-invoice-batch-oauth.mjs').catch(() => ({}))
function call<K extends GateFunction>(name: K, ...args: Parameters<Gate[K]>): ReturnType<Gate[K]> | undefined {
  const implementation = gate[name]
  return typeof implementation === 'function'
    ? (implementation as (...parameters: Parameters<Gate[K]>) => ReturnType<Gate[K]>)(...args) : undefined
}
const image = 'sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab'
const oauthVolume = 'wd-ai-oauth-piotr-local-20260911'
const args = ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', oauthVolume]
const ids = ['job-pln', 'job-eur', 'job-blank', 'job-correction']
const jobs = () => ids.map((id) => ({ id, kind: 'INVOICE_EXTRACT', status: 'QUEUED', attempts: 0 }))
const expectedPln = {
  documentType: 'INVOICE', supplierName: 'SYNTHETIC SUPPLIER', taxId: 'PL1234567890',
  invoiceNumber: 'FV/TEST/2026/09/01', issueDate: '2026-09-10', dueDate: '2026-09-24',
  currency: 'PLN', gross: 123, net: 100, vat: 23, bankAccount: null, paymentStatus: 'UNPAID',
}
const expectedEur = {
  documentType: 'INVOICE', supplierName: 'SYNTHETIC EURO SUPPLIER', taxId: 'DE123456789',
  invoiceNumber: 'EU/TEST/2026/09/02', issueDate: '2026-09-10', dueDate: '2026-09-24',
  currency: 'EUR', gross: 100, net: 80, vat: 20, bankAccount: null, paymentStatus: 'UNPAID',
}

describe('mixed invoice batch manual OAuth gate: offline contracts', () => {
  it('requires explicit consent and the exact reviewed image and OAuth volume', () => {
    expect(call('parseInvoiceBatchOAuthArgs', args)).toEqual({ image, oauthVolume })
    for (const invalid of [
      [], args.slice(1), [...args, '--retry'], [...args, '--confirm-synthetic-oauth'],
      [...args, '--model', 'other'], [...args, '--bind', '0.0.0.0'],
      ['--confirm-synthetic-oauth', '--image', `sha256:${'a'.repeat(64)}`, '--oauth-volume', oauthVolume],
      ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', 'other-owner'],
    ]) expect(() => call('parseInvoiceBatchOAuthArgs', invalid)).toThrow()
  })

  it('declares six inputs, four unique jobs, two expenses and a fixed four-claim budget without fallback', () => {
    expect('INVOICE_BATCH_LIMITS' in gate ? gate.INVOICE_BATCH_LIMITS : undefined).toEqual({
      inputFiles: 6, acceptedUniqueFiles: 4, maximumModelClaims: 4, maximumClaimsPerJob: 1,
      approvedInvoices: 2, activeCosts: 2, recognizedGrossPLN: 553,
      providerFallback: false, automaticHarnessRetry: false,
    })
    const plan = call('invoiceBatchFixturePlan')
    expect(plan?.map((fixture) => ({ key: fixture.key, mimeType: fixture.mimeType, pageCount: fixture.pageCount })))
      .toEqual([
        { key: 'pln', mimeType: 'image/png', pageCount: null },
        { key: 'eur', mimeType: 'application/pdf', pageCount: 2 },
        { key: 'blank', mimeType: 'image/png', pageCount: null },
        { key: 'correction', mimeType: 'image/png', pageCount: null },
        { key: 'duplicate', mimeType: 'image/png', pageCount: null },
        { key: 'malformed', mimeType: 'application/pdf', pageCount: null },
      ])
    expect(plan?.find((fixture) => fixture.key === 'pln')?.expected).toEqual(expectedPln)
    expect(plan?.find((fixture) => fixture.key === 'eur')?.expected).toEqual(expectedEur)
  })

  it('allows only pdfinfo and pdftoppm at explicit local locations including the installed Codex runtime', () => {
    for (const name of ['pdfinfo', 'pdftoppm']) {
      expect(call('invoiceBatchPdfBinaryCandidates', name)).toEqual([
        `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`,
        `/Users/piotr/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/${name}`,
      ])
    }
    for (const invalid of ['curl', '../pdfinfo', '/usr/bin/pdfinfo', '', undefined]) {
      expect(() => call('invoiceBatchPdfBinaryCandidates', invalid)).toThrow('UNSUPPORTED_PDF_BINARY')
    }
  })

  it('renders real PNGs and a two-page PDF in memory, duplicates only PLN bytes, and keeps the bad PDF structurally invalid', async () => {
    const rendered = await call('createInvoiceBatchFixtureBytes')
    expect(rendered).toHaveLength(6)
    if (!rendered) throw new Error('FIXTURE_IMPLEMENTATION_REQUIRED')
    const byKey = new Map(rendered.map((entry) => [entry.key, entry]))
    const hash = (key: string) => createHash('sha256').update(byKey.get(key)!.bytes).digest('hex')
    expect(hash('duplicate')).toBe(hash('pln'))
    expect(new Set(['pln', 'eur', 'blank', 'correction'].map(hash))).toHaveLength(4)
    for (const key of ['pln', 'blank', 'correction', 'duplicate']) {
      expect(byKey.get(key)!.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
    const pdf = byKey.get('eur')!.bytes.toString('latin1')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2)
    expect(pdf).toContain('DE123456789')
    expect(pdf).toContain('100.00 EUR')
    expect(pdf).toContain('80.00 EUR')
    expect(pdf).toContain('20.00 EUR')
    expect(pdf).toContain('UNPAID')
    const broken = byKey.get('malformed')!.bytes.toString('ascii')
    expect(broken.startsWith('%PDF-')).toBe(true)
    expect(broken).not.toContain('/Type /Page')
    expect(broken).not.toContain('xref')
  })

  it('uses the production schema and every printed fact for both valid documents', () => {
    for (const [key, expected] of [['pln', expectedPln], ['eur', expectedEur]] as const) {
      expect(call('assessInvoiceBatchEvidence', key, { ...expected, warnings: [] }, aiInvoiceResultSchema))
        .toEqual({ passed: true, checked: expected })
      for (const [field, value] of Object.entries(expected)) {
        const wrong = { ...expected, [field]: value === null ? 'invented' : null, warnings: [] }
        expect(call('assessInvoiceBatchEvidence', key, wrong, aiInvoiceResultSchema)?.passed).toBe(false)
      }
      expect(call('assessInvoiceBatchEvidence', key, { ...expected, warnings: [], rawProviderLog: 'unexpected' }, aiInvoiceResultSchema)?.passed)
        .toBe(false)
    }
  })

  it('fails closed if the result schema is missing or the response has no accepted source fixture', () => {
    for (const schema of [undefined, null, {}, { safeParse: false }]) {
      expect(call('assessInvoiceBatchEvidence', 'pln', { ...expectedPln, warnings: [] }, schema))
        .toEqual({ passed: false, code: 'INVALID_RESULT_SCHEMA' })
    }
    for (const key of ['duplicate', 'malformed', 'unknown']) {
      expect(call('assessInvoiceBatchEvidence', key, { ...expectedPln, warnings: [] }, aiInvoiceResultSchema))
        .toEqual({ passed: false, code: 'UNEXPECTED_EXTRACTION' })
    }
  })

  it('rejects a stripped German tax prefix, a zero invented from the blank page and a positive correction', () => {
    expect(call('assessInvoiceBatchEvidence', 'eur', { ...expectedEur, taxId: '123456789', warnings: [] }, aiInvoiceResultSchema))
      .toEqual({ passed: false, code: 'VALUE_MISMATCH' })
    const empty = Object.fromEntries(Object.keys(expectedPln).map((key) => [key, null]))
    expect(call('assessInvoiceBatchEvidence', 'blank', { ...empty, warnings: [] }, aiInvoiceResultSchema)?.passed).toBe(true)
    expect(call('assessInvoiceBatchEvidence', 'blank', { ...empty, documentType: 'OTHER', paymentStatus: 'UNKNOWN', warnings: [] }, aiInvoiceResultSchema)?.passed)
      .toBe(true)
    expect(call('assessInvoiceBatchEvidence', 'blank', { ...empty, gross: 0, warnings: [] }, aiInvoiceResultSchema)?.passed).toBe(false)
    const correction = call('invoiceBatchFixturePlan')?.find((fixture) => fixture.key === 'correction')?.expected
    expect(correction).toMatchObject({ documentType: 'CORRECTION', gross: -123, net: -100, vat: -23 })
    expect(call('assessInvoiceBatchEvidence', 'correction', { ...correction, warnings: [] }, aiInvoiceResultSchema)?.passed).toBe(true)
    expect(call('assessInvoiceBatchEvidence', 'correction', { ...correction, gross: 123, warnings: [] }, aiInvoiceResultSchema)?.passed).toBe(false)
  })

  it('accepts only the exact known job set and one executor progressing to exactly four durable claims', () => {
    const state = jobs()
    expect(call('assessInvoiceBatchBudget', state, ids)).toEqual({ passed: true, complete: false, claims: 0 })
    for (const job of state) {
      job.status = 'RUNNING'; job.attempts = 1
      expect(call('assessInvoiceBatchBudget', state, ids)).toMatchObject({ passed: true, complete: false })
      job.status = 'SUCCEEDED'
    }
    expect(call('assessInvoiceBatchBudget', state, ids)).toEqual({ passed: true, complete: true, claims: 4 })
  })

  const invalidJobStates: Array<(state: ReturnType<typeof jobs>) => ReturnType<typeof jobs>> = [
    (state) => [...state, { id: 'unexpected-fifth', kind: 'INVOICE_EXTRACT', status: 'QUEUED', attempts: 0 }],
    (state) => state.slice(1),
    (state) => state.map((job, i) => i === 0 ? { ...job, attempts: 2, status: 'SUCCEEDED' } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, attempts: 1, status: 'QUEUED' } : job),
    (state) => state.map((job, i) => i < 2 ? { ...job, attempts: 1, status: 'RUNNING' } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, kind: 'FINANCE_CHAT' } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, id: 'another-job' } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, attempts: -1 } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, attempts: 0.5 } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, status: 'FAILED', attempts: 1 } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, status: 'BLOCKED', attempts: 1 } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, status: 'CANCELLED' } : job),
    (state) => state.map((job, i) => i === 0 ? { ...job, status: 'SUCCEEDED', attempts: 0 } : job),
  ]
  it.each(invalidJobStates)('fails closed before continuing on unplanned jobs, retry, concurrent execution or invalid claim evidence %#', (mutate) => {
    expect(call('assessInvoiceBatchBudget', mutate(jobs()), ids)?.passed).toBe(false)
  })

  it('refuses malformed and duplicate job IDs before producing the local SQLite budget guard', () => {
    expect(call('invoiceBatchClaimGuards', ids)).toHaveLength(2)
    for (const invalid of [[], ids.slice(1), [...ids, 'fifth'], [...ids.slice(0, 3), ids[0]],
      [...ids.slice(0, 3), "evil'); DROP TABLE AiJob; --"]]) {
      expect(() => call('invoiceBatchClaimGuards', invalid)).toThrow('INVALID_ALLOWED_JOB_SET')
    }
  })

  it('enforces the claim fences on real SQLite, preserving four single claims after rejected mutations', () => {
    const guards = call('invoiceBatchClaimGuards', ids)
    expect(guards).toHaveLength(2)
    const sql = [
      'CREATE TABLE AiJob (id TEXT PRIMARY KEY, kind TEXT NOT NULL, attempts INTEGER NOT NULL, status TEXT NOT NULL);',
      ...ids.map((id) => `INSERT INTO AiJob VALUES ('${id}', 'INVOICE_EXTRACT', 0, 'QUEUED');`),
      ...guards!.map((statement) => `${statement};`),
      ...ids.map((id) => `UPDATE AiJob SET attempts = 1, status = 'SUCCEEDED' WHERE id = '${id}';`),
      "UPDATE AiJob SET attempts = 2 WHERE id = 'job-pln';",
      "UPDATE AiJob SET attempts = 0 WHERE id = 'job-eur';",
      "UPDATE AiJob SET kind = 'FINANCE_CHAT' WHERE id = 'job-blank';",
      "UPDATE AiJob SET id = 'replacement-job' WHERE id = 'job-correction';",
      "INSERT INTO AiJob VALUES ('fifth-job', 'INVOICE_EXTRACT', 0, 'QUEUED');",
      'SELECT id, kind, attempts, status FROM AiJob ORDER BY id;',
    ].join('\n')
    // SQLite keeps processing after each rejected statement, so the final
    // readback proves all four accepted claims survived unchanged.
    const result = spawnSync('/usr/bin/sqlite3', [':memory:'], { input: sql, encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr.match(/INVOICE_BATCH_CLAIM_LIMIT/g)).toHaveLength(4)
    expect(result.stderr.match(/INVOICE_BATCH_JOB_SET_FROZEN/g)).toHaveLength(1)
    expect(result.stdout.trim().split('\n')).toEqual([...ids].sort()
      .map((id) => `${id}|INVOICE_EXTRACT|1|SUCCEEDED`))
  })

  it('does not start a worker when cancellation arrives during ownership verification', async () => {
    const guardedStart = (gate as Record<string, unknown>).startInvoiceBatchWorkerWithinBoundary
    expect(typeof guardedStart).toBe('function')
    if (typeof guardedStart !== 'function') throw new Error('GUARDED_START_REQUIRED')
    let cancelled = false, starts = 0
    const assertActive = () => { if (cancelled) throw new Error('INTERRUPTED') }
    await expect(guardedStart(async () => { cancelled = true }, assertActive, () => { starts++; return 'started' }))
      .rejects.toThrow('INTERRUPTED')
    expect(starts).toBe(0)
    cancelled = false
    await expect(guardedStart(async () => {}, assertActive, () => { starts++; return 'started' }))
      .resolves.toBe('started')
    expect(starts).toBe(1)
  })

  it('recognizes the native Chromium PDF plugin only when bound to the current preview blob', () => {
    const matches = (gate as Record<string, unknown>).invoiceBatchPdfPluginMatches
    expect(typeof matches).toBe('function')
    if (typeof matches !== 'function') throw new Error('PDF_PLUGIN_MATCHER_REQUIRED')
    const url = 'blob:http://127.0.0.1:3000/synthetic-pdf'
    expect(matches({ type: 'application/x-google-chrome-pdf', originalUrl: url }, url)).toBe(true)
    for (const invalid of [
      { type: 'image/png', originalUrl: url },
      { type: 'application/x-google-chrome-pdf', originalUrl: `${url}-other` },
      { type: 'application/x-google-chrome-pdf', originalUrl: null },
    ]) expect(matches(invalid, url)).toBe(false)
  })
})
