import { describe, expect, it } from 'vitest'
import type { KsefInvoiceMetadata } from '@/lib/finance/ksef-client'
import {
  invoiceDraftDataSchema,
  type InvoiceDraftData,
} from '@/lib/invoice-import/contracts'
import { validateInvoiceApproval } from '@/lib/invoice-import/approval-policy'
import {
  applyKsefSnapshotToDraft,
  buildKsefReconciliationSnapshot,
  compareKsefReconciliation,
  ksefReconciliationSnapshotSchema,
} from '@/lib/invoice-import/ksef-reconciliation-policy'

const metadata = (overrides: Partial<KsefInvoiceMetadata> = {}): KsefInvoiceMetadata => ({
  ksefNumber: '1234567890-20260911-ABCDEF-01',
  invoiceNumber: 'FV/09/2026',
  issueDate: '2026-09-11',
  seller: { nip: 'PL 123-456-78-90', name: 'Dostawca Sp. z o.o.' },
  grossAmount: 123,
  netAmount: 100,
  vatAmount: 23,
  currency: 'PLN',
  ...overrides,
})

const fa3Xml = (payment: string): string => `<?xml version="1.0"?>
<fa:Faktura xmlns:fa="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <fa:Fa><fa:Platnosc>${payment}</fa:Platnosc></fa:Fa>
</fa:Faktura>`

const draft = (overrides: InvoiceDraftData = {}): InvoiceDraftData => ({
  documentType: 'INVOICE',
  supplierName: 'Dostawca — nazwa administracyjna',
  taxId: '1234567890',
  invoiceNumber: 'FV/09/2026',
  issueDate: '2026-09-11',
  currency: 'PLN',
  gross: 123,
  net: 100,
  vat: 23,
  dueDate: null,
  bankAccount: null,
  paymentStatus: 'PAID',
  paidAt: '2026-09-10',
  costCenterId: 'JAG',
  tagIds: ['materials'],
  notes: 'Ręczna notatka administratora',
  ...overrides,
})

describe('KSeF reconciliation snapshot', () => {
  it('builds a strict serialized snapshot from authoritative metadata without inferred payment', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata(), null)

    expect(snapshot).toEqual({
      externalId: '1234567890-20260911-ABCDEF-01',
      documentStatus: 'ACTIVE',
      data: {
        documentType: 'INVOICE',
        supplierName: 'Dostawca Sp. z o.o.',
        taxId: 'PL 123-456-78-90',
        invoiceNumber: 'FV/09/2026',
        issueDate: '2026-09-11',
        currency: 'PLN',
        gross: 123,
        net: 100,
        vat: 23,
        dueDate: null,
        bankAccount: null,
        paymentStatus: 'UNKNOWN',
        paidAt: null,
      },
    })
    expect(ksefReconciliationSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))))
      .toEqual(snapshot)
  })

  it('keeps a full foreign tax identifier and raw EUR amounts while representing absent net/VAT as unknown', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: 'IE6388047V', name: 'AWS EMEA SARL' },
      currency: ' eur ',
      grossAmount: 10.005,
      netAmount: undefined as never,
      vatAmount: undefined as never,
    }), null)

    expect(snapshot.data).toMatchObject({
      supplierName: 'AWS EMEA SARL',
      taxId: 'IE6388047V',
      currency: 'EUR',
      gross: 10.005,
      net: null,
      vat: null,
    })
  })

  it('accepts a supplier name without a tax ID and keeps the missing tax identity explicit', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: null as never, name: 'Supplier without a tax ID' },
    }), null)

    expect(snapshot.data).toMatchObject({
      supplierName: 'Supplier without a tax ID',
      taxId: null,
    })
    expect(invoiceDraftDataSchema.safeParse(snapshot.data).success).toBe(true)
  })

  it.each([
    ['external ID', { ksefNumber: '' }],
    ['bounded external ID', { ksefNumber: 'x'.repeat(192) }],
    ['invoice number', { invoiceNumber: '' }],
    ['issue date', { issueDate: '2026-02-31' }],
    ['supplier identity', { seller: { nip: ' ', name: ' ' } }],
    ['finite gross', { grossAmount: Number.POSITIVE_INFINITY }],
    ['three-letter currency', { currency: 'EURO' }],
  ] as const)('rejects missing or invalid required %s with a typed non-sensitive error', (_label, overrides) => {
    let thrown: unknown
    try {
      buildKsefReconciliationSnapshot(metadata(overrides as Partial<KsefInvoiceMetadata>), null)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'INVALID_KSEF_SNAPSHOT' })
    expect(String(thrown)).toBe('KsefReconciliationPolicyError: INVALID_KSEF_SNAPSHOT')
  })

  it('rejects unknown serialized fields instead of silently persisting them', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata(), null)

    expect(ksefReconciliationSnapshotSchema.safeParse({
      ...snapshot,
      rawMetadata: { accessToken: 'must-not-survive' },
    }).success).toBe(false)
    expect(ksefReconciliationSnapshotSchema.safeParse({
      ...snapshot,
      data: { ...snapshot.data, inventedAmount: 999 },
    }).success).toBe(false)
  })

  it('rejects a serialized unsupported status disguised as an approvable invoice type', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({ documentStatus: 'CANCELLED' }), null)

    expect(ksefReconciliationSnapshotSchema.safeParse({
      ...snapshot,
      data: { ...snapshot.data, documentType: 'INVOICE' },
    }).success).toBe(false)
  })

  it.each(['UNKNOWN', 'UNPAID', 'PARTIAL'] as const)(
    'rejects a serialized paidAt paired with %s payment',
    (paymentStatus) => {
      const snapshot = buildKsefReconciliationSnapshot(metadata(), null)

      expect(ksefReconciliationSnapshotSchema.safeParse({
        ...snapshot,
        data: { ...snapshot.data, paymentStatus, paidAt: '2026-09-12' },
      }).success).toBe(false)
    },
  )

  it.each([
    [{}, 'ACTIVE', 'INVOICE'],
    [{ documentStatus: 'CORRECTED' }, 'CORRECTED', 'CORRECTION'],
    [{ documentStatus: 'CORRECTION' }, 'CORRECTION', 'CORRECTION'],
    [{ documentType: 'CORRECTION' }, 'CORRECTION', 'CORRECTION'],
    [{ documentStatus: 'CANCELLED' }, 'CANCELLED', 'OTHER'],
  ] as const)('maps metadata %o to document status %s and draft type %s', (overrides, status, type) => {
    const snapshot = buildKsefReconciliationSnapshot(metadata(overrides), null)

    expect(snapshot).toMatchObject({ documentStatus: status, data: { documentType: type } })
  })

  it.each(['KOR', 'KOR_ZAL', 'KOR_ROZ'] as const)(
    'keeps legitimate raw KSeF correction family %s blocked as CORRECTION',
    (documentType) => {
      const snapshot = buildKsefReconciliationSnapshot(metadata({ documentType }), null)

      expect(snapshot).toMatchObject({
        documentStatus: 'CORRECTION',
        data: { documentType: 'CORRECTION' },
      })
    },
  )

  it.each(['DRAFT', 'REJECTED'] as const)(
    'rejects unknown explicit document status %s instead of downgrading it to ACTIVE',
    (documentStatus) => {
      expect(() => buildKsefReconciliationSnapshot(metadata({ documentStatus }), null))
        .toThrow(expect.objectContaining({ code: 'INVALID_KSEF_SNAPSHOT' }))
    },
  )

  it('rejects a NUL-bearing external ID before it can reach the database boundary', () => {
    expect(() => buildKsefReconciliationSnapshot(metadata({
      ksefNumber: 'KSEF\u0000INJECTED',
    }), null)).toThrow(expect.objectContaining({ code: 'INVALID_KSEF_SNAPSHOT' }))
  })

  it('reads an explicit namespaced FA(3) paid marker, date, due date, and bank account', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      paymentDueDate: '2026-10-31',
      bankAccount: 'metadata-account',
    }), fa3Xml(`
      <fa:Zaplacono>1</fa:Zaplacono>
      <fa:DataZaplaty>2026-09-10</fa:DataZaplaty>
      <fa:TerminPlatnosci><fa:Termin>2026-10-01</fa:Termin></fa:TerminPlatnosci>
      <fa:RachunekBankowy><fa:NrRB>PL 12 abCD 3456 7890</fa:NrRB></fa:RachunekBankowy>
    `))

    expect(snapshot.data).toMatchObject({
      paymentStatus: 'PAID',
      paidAt: '2026-09-10',
      dueDate: '2026-10-01',
      bankAccount: 'PL 12 abCD 3456 7890',
    })
  })

  it.each([
    ['1', 'PARTIAL'],
    ['2', 'PAID'],
  ] as const)('maps FA(3) partial-payment marker %s to %s without inventing paidAt', (marker, status) => {
    const snapshot = buildKsefReconciliationSnapshot(
      metadata(),
      fa3Xml(`<fa:ZnacznikZaplatyCzesciowej>${marker}</fa:ZnacznikZaplatyCzesciowej>
        <fa:DataZaplaty>2026-09-10</fa:DataZaplaty>`),
    )

    expect(snapshot.data).toMatchObject({ paymentStatus: status, paidAt: null })
  })

  it('uses valid metadata due date and bank account only as fallback when XML has no values', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      paymentDueDate: 'not-a-date',
      dueDate: '2026-10-15',
      bankAccount: '  DE89 3704 0044 0532 0130 00  ',
    }), null)

    expect(snapshot.data).toMatchObject({
      dueDate: '2026-10-15',
      bankAccount: 'DE89 3704 0044 0532 0130 00',
      paymentStatus: 'UNKNOWN',
      paidAt: null,
    })
  })

  it.each([
    ['missing XML', null],
    ['payment form without an official marker', fa3Xml('<fa:FormaPlatnosci>1</fa:FormaPlatnosci>')],
    ['marker in a comment', fa3Xml('<!-- <fa:Zaplacono>1</fa:Zaplacono> -->')],
    ['marker in CDATA', fa3Xml('<![CDATA[<fa:Zaplacono>1</fa:Zaplacono>]]>')],
    ['marker in a nested unrelated container', fa3Xml('<fa:Uwagi><fa:Zaplacono>1</fa:Zaplacono></fa:Uwagi>')],
    ['duplicate marker', fa3Xml('<fa:Zaplacono>1</fa:Zaplacono><fa:Zaplacono>1</fa:Zaplacono>')],
    ['contradictory markers', fa3Xml('<fa:Zaplacono>1</fa:Zaplacono><fa:ZnacznikZaplatyCzesciowej>1</fa:ZnacznikZaplatyCzesciowej>')],
    ['invalid full-payment marker', fa3Xml('<fa:Zaplacono>0</fa:Zaplacono>')],
    ['invalid partial-payment marker', fa3Xml('<fa:ZnacznikZaplatyCzesciowej>3</fa:ZnacznikZaplatyCzesciowej>')],
  ] as const)('keeps payment UNKNOWN for %s', (_label, xml) => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({ issueDate: '2026-09-01' }), xml)

    expect(snapshot.data).toMatchObject({ paymentStatus: 'UNKNOWN', paidAt: null })
  })

  it.each([
    ['full marker plus a self-closing duplicate', '<Zaplacono>1</Zaplacono><Zaplacono />'],
    ['partial marker plus a self-closing duplicate', '<ZnacznikZaplatyCzesciowej>2</ZnacznikZaplatyCzesciowej><ZnacznikZaplatyCzesciowej />'],
    ['full marker plus a nested duplicate', '<Zaplacono>1</Zaplacono><Zaplacono><Zaplacono>1</Zaplacono></Zaplacono>'],
    ['CDATA spliced into a full marker', '<Zaplacono><![CDATA[0]]>1</Zaplacono>'],
  ] as const)('keeps payment UNKNOWN for malformed or duplicate XML: %s', (_label, payment) => {
    expect(buildKsefReconciliationSnapshot(metadata(), fa3Xml(payment)).data).toMatchObject({
      paymentStatus: 'UNKNOWN',
      paidAt: null,
    })
  })

  it('rejects malformed closing-tag syntax instead of accepting a paid marker prefix', () => {
    expect(() => buildKsefReconciliationSnapshot(
      metadata(),
      fa3Xml('<Zaplacono>1</Zaplacono nonsense>'),
    )).toThrow(expect.objectContaining({ code: 'INVALID_KSEF_SNAPSHOT' }))
  })

  it.each([
    ['garbage in an opening tag', '<Zaplacono garbage>1</Zaplacono>'],
    ['an unterminated attribute', '<Zaplacono source="unterminated>1</Zaplacono>'],
    ['a duplicate attribute', '<Zaplacono source="a" source="b">1</Zaplacono>'],
  ] as const)('rejects malformed XML containing %s instead of returning PAID', (_label, payment) => {
    expect(() => buildKsefReconciliationSnapshot(metadata(), fa3Xml(payment)))
      .toThrow(expect.objectContaining({ code: 'INVALID_KSEF_SNAPSHOT' }))
  })

  it.each([
    ['a comment', '<!-- not an account -->'],
    ['CDATA', '<![CDATA[not an account]]>'],
  ] as const)('falls back to metadata when an XML bank-account scalar contains only %s', (_label, content) => {
    const snapshot = buildKsefReconciliationSnapshot(
      metadata({ bankAccount: 'METADATA BANK ACCOUNT' }),
      fa3Xml(`<RachunekBankowy><NrRB>${content}</NrRB></RachunekBankowy>`),
    )

    expect(snapshot.data.bankAccount).toBe('METADATA BANK ACCOUNT')
  })

  it.each([
    ['multiple root elements', `${fa3Xml('<Zaplacono>1</Zaplacono>')}<Faktura />`],
    ['an unbound namespace prefix', '<fa:Faktura><fa:Fa /></fa:Faktura>'],
    ['more than 128 open elements', `<Faktura>${'<x>'.repeat(128)}${'</x>'.repeat(128)}</Faktura>`],
  ] as const)('rejects XML with %s', (_label, xml) => {
    expect(() => buildKsefReconciliationSnapshot(metadata(), xml))
      .toThrow(expect.objectContaining({ code: 'INVALID_KSEF_SNAPSHOT' }))
  })

  it('treats empty cross-markers as contradictory presence, not absence', () => {
    const snapshot = buildKsefReconciliationSnapshot(
      metadata(),
      fa3Xml('<Zaplacono /><ZnacznikZaplatyCzesciowej />'),
    )

    expect(snapshot.data).toMatchObject({ paymentStatus: 'UNKNOWN', paidAt: null })
  })

  it('ignores an official-looking marker outside the exact Faktura/Fa/Platnosc path', () => {
    const xml = '<Faktura><Fa><Warunki><Platnosc><Zaplacono>1</Zaplacono></Platnosc></Warunki></Fa></Faktura>'

    expect(buildKsefReconciliationSnapshot(metadata(), xml).data.paymentStatus).toBe('UNKNOWN')
  })

  it('bounds collection time for many siblings beneath a long unknown ancestor', () => {
    const ancestor = 'a'.repeat(500_000)
    const xml = `<Faktura><${ancestor}>${'<x/>'.repeat(100_000)}</${ancestor}>
      <Fa><Platnosc><TerminPlatnosci><Termin>2026-10-01</Termin></TerminPlatnosci></Platnosc></Fa>
    </Faktura>`
    const started = performance.now()
    const snapshot = buildKsefReconciliationSnapshot(metadata(), xml)
    const elapsed = performance.now() - started

    expect(snapshot.data).toMatchObject({ paymentStatus: 'UNKNOWN', paidAt: null, dueDate: '2026-10-01' })
    // This 1.4 MiB / depth-3 subtree must not cause ~50 GB of ancestor-path copies.
    // The budget leaves ample headroom over a single linear SAX pass.
    expect(elapsed).toBeLessThan(1_000)
  })

  it.each([
    ['a document type declaration', '<!DOCTYPE Faktura [<!ENTITY paid "1">]><Faktura />'],
    ['an entity declaration', '<!ENTITY paid "1"><Faktura />'],
    ['XML larger than 4 MiB', `<Faktura>${'x'.repeat((4 * 1024 * 1024) + 1)}</Faktura>`],
  ])('rejects unsafe XML containing %s', (_label, xml) => {
    expect(() => buildKsefReconciliationSnapshot(metadata(), xml))
      .toThrow(expect.objectContaining({ code: 'INVALID_KSEF_SNAPSHOT' }))
  })
})

describe('KSeF reconciliation comparison', () => {
  it.each(['UNKNOWN', 'UNPAID', 'PARTIAL'] as const)(
    'rejects a stored %s snapshot with paidAt instead of advertising its date',
    (paymentStatus) => {
      const snapshot = buildKsefReconciliationSnapshot(metadata(), null)

      expect(() => compareKsefReconciliation(draft(), {
        ...snapshot,
        data: { ...snapshot.data, paymentStatus, paidAt: '2026-09-12' },
      })).toThrow()
    },
  )

  it('accepts cent-equivalent money and canonical identity while preserving an admin supplier display name', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      invoiceNumber: '  fv/09/2026  ',
      seller: { nip: 'PL 123-456-78-90', name: 'Oficjalna nazwa z KSeF' },
      grossAmount: 123.004,
    }), null)

    expect(compareKsefReconciliation(draft(), snapshot)).toEqual([])
  })

  it('preserves foreign tax-ID letters while applying canonical punctuation and case equivalence', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: 'ie-6388047v', name: 'AWS EMEA' },
    }), null)

    expect(compareKsefReconciliation(draft({
      supplierName: 'Local AWS label',
      taxId: 'IE 6388047V',
    }), snapshot)).toEqual([])
  })

  it('does not let canonically blank tax IDs suppress a supplier-name difference', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: '---', name: 'KSeF supplier name' },
    }), null)

    expect(compareKsefReconciliation(draft({
      supplierName: 'Local supplier name',
      taxId: '...',
    }), snapshot)).toContainEqual({
      field: 'supplierName',
      localValue: 'Local supplier name',
      ksefValue: 'KSeF supplier name',
    })
  })

  it('reports known differences in stable policy order with original values', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: 'IE6388047V', name: 'Dostawca — nazwa administracyjna' },
      invoiceNumber: 'KSEF/9/2026',
      issueDate: '2026-09-12',
      currency: 'EUR',
      grossAmount: 124.005,
      netAmount: 101.005,
      vatAmount: 23,
    }), fa3Xml(`
      <Zaplacono>1</Zaplacono><DataZaplaty>2026-09-12</DataZaplaty>
      <TerminPlatnosci><Termin>2026-10-01</Termin></TerminPlatnosci>
      <RachunekBankowy><NrRB>DE89 abcd 1234</NrRB></RachunekBankowy>
    `))

    expect(compareKsefReconciliation(draft({
      dueDate: '2026-09-30',
      bankAccount: 'PL11 2222 3333',
      paymentStatus: 'PARTIAL',
    }), snapshot)).toEqual([
      { field: 'taxId', localValue: '1234567890', ksefValue: 'IE6388047V' },
      { field: 'invoiceNumber', localValue: 'FV/09/2026', ksefValue: 'KSEF/9/2026' },
      { field: 'issueDate', localValue: '2026-09-11', ksefValue: '2026-09-12' },
      { field: 'currency', localValue: 'PLN', ksefValue: 'EUR' },
      { field: 'gross', localValue: 123, ksefValue: 124.005 },
      { field: 'net', localValue: 100, ksefValue: 101.005 },
      { field: 'dueDate', localValue: '2026-09-30', ksefValue: '2026-10-01' },
      { field: 'bankAccount', localValue: 'PL11 2222 3333', ksefValue: 'DE89 abcd 1234' },
      { field: 'paymentStatus', localValue: 'PARTIAL', ksefValue: 'PAID' },
      { field: 'paidAt', localValue: '2026-09-10', ksefValue: '2026-09-12' },
    ])
  })

  it('ignores unknown incoming optional and payment values instead of clearing known local decisions', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      netAmount: undefined as never,
      vatAmount: undefined as never,
    }), null)

    expect(compareKsefReconciliation(draft({
      net: 999,
      vat: 888,
      dueDate: '2026-10-10',
      bankAccount: 'LOCAL ACCOUNT',
      paymentStatus: 'PAID',
      paidAt: '2026-09-10',
    }), snapshot)).toEqual([])
  })

  it('reports an absent local value when KSeF supplies a known optional value', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata(), fa3Xml(
      '<TerminPlatnosci><Termin>2026-10-01</Termin></TerminPlatnosci>',
    ))
    const current = draft()
    delete current.dueDate

    expect(compareKsefReconciliation(current, snapshot)).toContainEqual({
      field: 'dueDate',
      localValue: undefined,
      ksefValue: '2026-10-01',
    })
  })

  it('compares bank accounts without case or whitespace conflicts while retaining their raw values', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      bankAccount: 'de89 abCD 1234',
    }), null)

    expect(compareKsefReconciliation(draft({ bankAccount: 'DE89ABCD1234' }), snapshot)).toEqual([])
    expect(snapshot.data.bankAccount).toBe('de89 abCD 1234')
  })

  it.each([
    [{ documentStatus: 'CORRECTED' }, 'CORRECTED', 'CORRECTION'],
    [{ documentType: 'CORRECTION' }, 'CORRECTION', 'CORRECTION'],
    [{ documentStatus: 'CANCELLED' }, 'CANCELLED', 'OTHER'],
  ] as const)('always exposes unsupported KSeF status %s as a review block', (metadataOverride, status, documentType) => {
    const snapshot = buildKsefReconciliationSnapshot(metadata(metadataOverride), null)

    expect(compareKsefReconciliation(draft({ documentType }), snapshot)[0]).toEqual({
      field: 'documentStatus',
      localValue: null,
      ksefValue: status,
    })
  })
})

describe('explicit KSeF snapshot application', () => {
  it.each(['UNKNOWN', 'UNPAID', 'PARTIAL'] as const)(
    'rejects a stored %s snapshot with paidAt before changing the admin payment decision',
    (paymentStatus) => {
      const snapshot = buildKsefReconciliationSnapshot(metadata(), null)
      const current = draft()

      expect(() => applyKsefSnapshotToDraft(current, {
        ...snapshot,
        data: { ...snapshot.data, paymentStatus, paidAt: '2026-09-12' },
      })).toThrow()
      expect(current).toEqual(draft())
    },
  )

  it('applies required identity while preserving classifications, notes, known optionals, and UNKNOWN payment', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: 'PL1234567890', name: 'Oficjalna nazwa KSeF' },
      netAmount: undefined as never,
      vatAmount: undefined as never,
    }), null)
    const current = draft({
      supplierName: 'Lokalna nazwa',
      net: 98,
      vat: 25,
      dueDate: '2026-10-10',
      bankAccount: 'LOCAL BANK',
      paymentStatus: 'PAID',
      paidAt: '2026-09-09',
      reportingGross: 123,
      reportingNet: 98,
      reportingVat: 25,
      conversionNote: 'Ręczne rozliczenie PLN',
      conversionConfirmed: true,
    })

    expect(applyKsefSnapshotToDraft(current, snapshot)).toEqual({
      ...current,
      supplierName: 'Oficjalna nazwa KSeF',
      taxId: 'PL1234567890',
    })
  })

  it('applies all known whitelisted fields and clears stale paidAt for PARTIAL', () => {
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      seller: { nip: 'IE6388047V', name: 'AWS EMEA SARL' },
      invoiceNumber: 'AWS/9/2026',
      issueDate: '2026-09-12',
      currency: 'EUR',
      grossAmount: 120,
      netAmount: 120,
      vatAmount: 0,
    }), fa3Xml(`
      <ZnacznikZaplatyCzesciowej>1</ZnacznikZaplatyCzesciowej>
      <TerminPlatnosci><Termin>2026-10-12</Termin></TerminPlatnosci>
      <RachunekBankowy><NrRB>DE89 1234</NrRB></RachunekBankowy>
    `))

    expect(applyKsefSnapshotToDraft(draft(), snapshot)).toEqual({
      ...draft(),
      supplierName: 'AWS EMEA SARL',
      taxId: 'IE6388047V',
      invoiceNumber: 'AWS/9/2026',
      issueDate: '2026-09-12',
      currency: 'EUR',
      gross: 120,
      net: 120,
      vat: 0,
      dueDate: '2026-10-12',
      bankAccount: 'DE89 1234',
      paymentStatus: 'PARTIAL',
      paidAt: null,
      conversionConfirmed: false,
    })
  })

  it('keeps PLN conversion evidence visible but withdraws confirmation after a foreign basis change', () => {
    const current = draft({
      currency: 'EUR',
      gross: 100,
      net: 80,
      vat: 20,
      reportingGross: 430,
      reportingNet: 344,
      reportingVat: 86,
      conversionNote: 'NBP 2026-09-10, kurs 4,30',
      conversionConfirmed: true,
    })
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      currency: 'EUR',
      grossAmount: 110,
      netAmount: 90,
      vatAmount: 20,
    }), null)

    expect(applyKsefSnapshotToDraft(current, snapshot)).toMatchObject({
      gross: 110,
      net: 90,
      vat: 20,
      reportingGross: 430,
      reportingNet: 344,
      reportingVat: 86,
      conversionNote: 'NBP 2026-09-10, kurs 4,30',
      conversionConfirmed: false,
    })
  })

  it('does not withdraw conversion confirmation for cent-equivalent incoming money', () => {
    const current = draft({ currency: 'EUR', gross: 10, net: 8, vat: 2, conversionConfirmed: true })
    const snapshot = buildKsefReconciliationSnapshot(metadata({
      currency: 'EUR',
      grossAmount: 10.004,
      netAmount: 8.004,
      vatAmount: 2.004,
    }), null)

    expect(applyKsefSnapshotToDraft(current, snapshot).conversionConfirmed).toBe(true)
  })

  it('withdraws structured EUR confirmation even for a subcent source change', () => {
    const current = draft({ currency: 'EUR', gross: 10, net: 8, vat: 2, conversionConfirmed: true,
      conversion: { mode: 'MANUAL_RATE', paymentDate: '2026-09-10', rate: '4.25', rateDate: null, tableNumber: null },
    })
    const snapshot = buildKsefReconciliationSnapshot(metadata({ currency: 'EUR', grossAmount: 10.004, netAmount: 8, vatAmount: 2 }), null)
    expect(applyKsefSnapshotToDraft(current, snapshot).conversionConfirmed).toBe(false)
  })

  it('clears stale paidAt when a strictly parsed stored snapshot explicitly says UNPAID', () => {
    const built = buildKsefReconciliationSnapshot(metadata(), null)
    const snapshot = ksefReconciliationSnapshotSchema.parse({
      ...built,
      data: { ...built.data, paymentStatus: 'UNPAID' },
    })

    expect(applyKsefSnapshotToDraft(draft(), snapshot)).toMatchObject({
      paymentStatus: 'UNPAID',
      paidAt: null,
    })
  })

  it('withdraws conversion confirmation when KSeF changes only payment date', () => {
    const current = draft({ conversionConfirmed: true })
    const built = buildKsefReconciliationSnapshot(metadata(), null)
    const snapshot = ksefReconciliationSnapshotSchema.parse({ ...built,
      data: { ...built.data, gross: current.gross, net: current.net, vat: current.vat, currency: current.currency,
        paymentStatus: 'PAID', paidAt: '2026-09-12' },
    })
    expect(applyKsefSnapshotToDraft(current, snapshot)).toMatchObject({ paidAt: '2026-09-12', conversionConfirmed: false })
  })

  it.each([
    [{ documentType: 'CORRECTION', grossAmount: -123, netAmount: -100, vatAmount: -23 }, 'CORRECTION_UNSUPPORTED'],
    [{ documentStatus: 'CANCELLED' }, 'OTHER_DOCUMENT_UNSUPPORTED'],
  ] as const)('keeps unsupported KSeF documents blocked by ordinary approval policy', (overrides, issueCode) => {
    const applied = applyKsefSnapshotToDraft(
      draft(),
      buildKsefReconciliationSnapshot(metadata(overrides), null),
    )
    const result = validateInvoiceApproval(applied)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain(issueCode)
  })
})
