import { describe, expect, it } from 'vitest'
import { buildCostWarningTotal, filterConfidentialCostEvents, sumAllocatedCostsByCenter, summarizeSupplierSpend } from '@/lib/finance/cost-reporting'

describe('summarizeSupplierSpend', () => {
  it('groups approved cost events by supplier NIP when available', () => {
    const rows = summarizeSupplierSpend([
      { supplierName: 'REMI', supplierNip: '9462595618', grossAmount: 100 },
      { supplierName: 'REMI sp.j.', supplierNip: '9462595618', grossAmount: 50 },
      { supplierName: 'No NIP', supplierNip: null, grossAmount: 25 },
    ])

    expect(rows).toEqual([
      { key: '9462595618', supplierName: 'REMI', supplierNip: '9462595618', grossAmount: 150 },
      { key: 'No NIP', supplierName: 'No NIP', supplierNip: null, grossAmount: 25 },
    ])
  })
})

describe('buildCostWarningTotal', () => {
  it('sums costs that can make reports incomplete', () => {
    expect(buildCostWarningTotal([
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 100 },
      { status: 'MAPPED', documentStatus: 'CORRECTION', currency: 'PLN', grossAmount: 50 },
      { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'EUR', grossAmount: 200 },
    ])).toBe(350)
  })
})

describe('filterConfidentialCostEvents', () => {
  it('hides confidential events from managers', () => {
    expect(filterConfidentialCostEvents([
      { id: 'public', isConfidential: false },
      { id: 'private', isConfidential: true },
    ], 'MANAGER')).toEqual([{ id: 'public', isConfidential: false }])
  })
})

describe('sumAllocatedCostsByCenter', () => {
  it('sums part amounts by allocation percentage', () => {
    expect(sumAllocatedCostsByCenter([
      {
        parts: [
          {
            grossAmount: 1000,
            allocations: [
              { costCenterId: 'JAG', percent: 60 },
              { costCenterId: 'PUL', percent: 40 },
            ],
          },
        ],
      },
    ])).toEqual({ JAG: 600, PUL: 400, GLOBAL: 0 })
  })
})
