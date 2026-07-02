import { describe, expect, it } from 'vitest'
import { buildAreaProfitabilityReport } from '@/lib/finance/area-profitability'
import { AreaRevenueEntrySchema } from '@/lib/validations/revenue'

const areaTags = [
  { id: 'tag-wallpapers', slug: 'wallpapers', name: 'Tapety' },
  { id: 'tag-installation', slug: 'installation', name: 'Montaż' },
]

describe('buildAreaProfitabilityReport', () => {
  it('combines area revenue with allocated CostEvent costs', () => {
    const report = buildAreaProfitabilityReport({
      year: 2026,
      areaTags,
      revenues: [
        { year: 2026, month: 4, costCenterId: 'JAG', areaTagId: 'tag-wallpapers', amount: 2000 },
        { year: 2026, month: 4, costCenterId: 'PUL', areaTagId: 'tag-wallpapers', amount: 1000 },
        { year: 2026, month: 4, costCenterId: 'JAG', areaTagId: 'tag-installation', amount: 500 },
      ],
      costEvents: [
        {
          eventDate: new Date('2026-04-14T00:00:00.000Z'),
          status: 'APPROVED',
          parts: [
            {
              grossAmount: 1000,
              tags: [{ tag: { id: 'tag-wallpapers', slug: 'wallpapers', name: 'Tapety', group: { slug: 'area' } } }],
              allocations: [
                { costCenterId: 'JAG', percent: 60 },
                { costCenterId: 'PUL', percent: 40 },
              ],
            },
            {
              grossAmount: 200,
              tags: [
                { tag: { id: 'tag-wallpapers', slug: 'wallpapers', name: 'Tapety', group: { slug: 'area' } } },
                { tag: { id: 'tag-installation', slug: 'installation', name: 'Montaż', group: { slug: 'area' } } },
              ],
              allocations: [{ costCenterId: 'JAG', percent: 100 }],
            },
            {
              grossAmount: 300,
              tags: [],
              allocations: [{ costCenterId: 'GLOBAL', percent: 100 }],
            },
          ],
        },
      ],
    })

    expect(report.rows).toEqual([
      {
        areaTagId: 'tag-wallpapers',
        slug: 'wallpapers',
        name: 'Tapety',
        revenue: 3000,
        costs: 1100,
        margin: 1900,
        marginRate: 0.6333,
        byCostCenter: { JAG: { revenue: 2000, costs: 700 }, PUL: { revenue: 1000, costs: 400 }, GLOBAL: { revenue: 0, costs: 0 } },
      },
      {
        areaTagId: 'tag-installation',
        slug: 'installation',
        name: 'Montaż',
        revenue: 500,
        costs: 100,
        margin: 400,
        marginRate: 0.8,
        byCostCenter: { JAG: { revenue: 500, costs: 100 }, PUL: { revenue: 0, costs: 0 }, GLOBAL: { revenue: 0, costs: 0 } },
      },
    ])
    expect(report.totals).toEqual({ revenue: 3500, costs: 1200, margin: 2300, marginRate: 0.6571 })
    expect(report.unassignedCosts).toBe(300)
  })

  it('can narrow the report to one cost center', () => {
    const report = buildAreaProfitabilityReport({
      year: 2026,
      costCenterId: 'PUL',
      areaTags,
      revenues: [
        { year: 2026, month: 4, costCenterId: 'JAG', areaTagId: 'tag-wallpapers', amount: 2000 },
        { year: 2026, month: 4, costCenterId: 'PUL', areaTagId: 'tag-wallpapers', amount: 1000 },
      ],
      costEvents: [
        {
          eventDate: new Date('2026-04-14T00:00:00.000Z'),
          status: 'APPROVED',
          parts: [
            {
              grossAmount: 1000,
              tags: [{ tag: { id: 'tag-wallpapers', slug: 'wallpapers', name: 'Tapety', group: { slug: 'area' } } }],
              allocations: [
                { costCenterId: 'JAG', percent: 60 },
                { costCenterId: 'PUL', percent: 40 },
              ],
            },
          ],
        },
      ],
    })

    expect(report.rows[0]).toMatchObject({
      revenue: 1000,
      costs: 400,
      margin: 600,
      marginRate: 0.6,
    })
    expect(report.totals).toEqual({ revenue: 1000, costs: 400, margin: 600, marginRate: 0.6 })
  })
})

describe('AreaRevenueEntrySchema', () => {
  it('accepts salon revenue assigned to an area tag', () => {
    const result = AreaRevenueEntrySchema.safeParse({
      year: 2026,
      month: 4,
      costCenterId: 'JAG',
      areaTagId: 'tag-wallpapers',
      amount: 12500,
    })

    expect(result.success).toBe(true)
  })

  it('rejects company/global area revenue because it must be entered per salon', () => {
    expect(AreaRevenueEntrySchema.safeParse({
      year: 2026,
      month: 4,
      costCenterId: 'COMPANY',
      areaTagId: 'tag-wallpapers',
      amount: 12500,
    }).success).toBe(false)
    expect(AreaRevenueEntrySchema.safeParse({
      year: 2026,
      month: 4,
      costCenterId: 'GLOBAL',
      areaTagId: 'tag-wallpapers',
      amount: 12500,
    }).success).toBe(false)
  })
})
