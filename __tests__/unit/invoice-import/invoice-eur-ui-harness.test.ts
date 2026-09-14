// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInvoiceEurUiFixtureBytes, invoiceEurUiFixtureFacts, parseInvoiceEurUiArgs } from '../../../scripts/validate-invoice-eur-ui.mjs'

describe('isolated EUR browser acceptance guard', () => {
  it('creates a genuine two-page paid EUR no-VAT PDF from the same facts used by the form', async () => {
    const facts = invoiceEurUiFixtureFacts
    const fixture = await createInvoiceEurUiFixtureBytes()
    expect(fixture.mimeType).toBe('application/pdf')
    expect(fixture.pageCount).toBe(2)
    const pdf = fixture.bytes.toString('latin1')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2)
    for (const value of [facts.invoiceNumber, facts.supplierName, facts.taxId, facts.issueDate, facts.paidAt,
      `Total: ${facts.gross} ${facts.currency}`, `Net: ${facts.net} ${facts.currency}`, `VAT: ${facts.vat} ${facts.currency}`, 'Payment status: PAID', 'No VAT charged']) {
      expect(pdf).toContain(value)
    }
    expect(facts).toMatchObject({ gross: '360.20', net: '360.20', vat: '0.00', paidAt: '2026-09-14' })
  })
  it('accepts only the explicit synthetic-local flag without arbitrary hosts or credentials', () => {
    expect(parseInvoiceEurUiArgs(['--confirm-synthetic-local'])).toEqual({ syntheticLocal: true })
    for (const args of [[], ['--confirm-synthetic-local', '--confirm-synthetic-local'], ['--confirm-synthetic-local', '--url', 'https://production.test'], ['--oauth-volume', 'existing'], ['--confirm-synthetic-local', '--skip-nbp']]) {
      expect(() => parseInvoiceEurUiArgs(args)).toThrow('SYNTHETIC_LOCAL_CONFIRMATION_REQUIRED')
    }
  })
  it('rejects an unconfirmed CLI run before creating any private run directory', async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('wd-eur-ui-')).sort()
    const result = spawnSync(process.execPath, [path.resolve('scripts/validate-invoice-eur-ui.mjs')], { encoding: 'utf8', timeout: 10_000 })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('SYNTHETIC_LOCAL_CONFIRMATION_REQUIRED')
    expect((await readdir(tmpdir())).filter((name) => name.startsWith('wd-eur-ui-')).sort()).toEqual(before)
  })
})
