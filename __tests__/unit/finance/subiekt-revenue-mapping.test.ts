import { describe, expect, it } from 'vitest'
import {
  SUBIEKT_WAREHOUSE_MAP_DEFAULT, aggregateSnapshots, mapRow, parseWarehouseMap, refreshWindow, snapshotSourceHash, subiektAsOfDate,
} from '@/lib/finance/subiekt-revenue'

describe('parseWarehouseMap', () => {
  it('should map PUŁ and MAG to salons and force INT to ECOMMERCE by default', () => {
    const { map, problems } = parseWarehouseMap(undefined)
    expect(problems).toEqual([])
    expect(map.get('PUŁ')).toEqual({ costCenterId: 'PUL', channel: null })
    expect(map.get('MAG')).toEqual({ costCenterId: 'JAG', channel: null })
    expect(map.get('INT')).toEqual({ costCenterId: 'PUL', channel: 'ECOMMERCE' })
  })

  it('should treat an empty variable as the default map', () => {
    expect([...parseWarehouseMap('  ').map.keys()]).toEqual([...parseWarehouseMap(SUBIEKT_WAREHOUSE_MAP_DEFAULT).map.keys()])
  })

  it('should report an unknown cost center instead of guessing', () => {
    const { map, problems } = parseWarehouseMap('MAG:JAG,XYZ:WAW')
    expect(map.has('XYZ')).toBe(false)
    expect(problems[0]).toContain('WAW')
  })

  it('should reject a forced channel the center does not allow', () => {
    const { map, problems } = parseWarehouseMap('MAG:JAG:ECOMMERCE')
    expect(map.has('MAG')).toBe(false)
    expect(problems[0]).toContain('ECOMMERCE')
  })

  it('should normalise symbol case and whitespace', () => {
    expect(parseWarehouseMap(' puł : PUL ').map.get('PUŁ')).toEqual({ costCenterId: 'PUL', channel: null })
  })
})

describe('mapRow', () => {
  const { map } = parseWarehouseMap(undefined)

  it('should send goods to SALON and services to MONTAZ', () => {
    expect(mapRow({ warehouse_symbol: 'PUŁ', kind: 'TOWAR' }, map)).toEqual({ costCenterId: 'PUL', channel: 'SALON' })
    expect(mapRow({ warehouse_symbol: 'MAG', kind: 'USLUGA' }, map)).toEqual({ costCenterId: 'JAG', channel: 'MONTAZ' })
  })

  it('should route both kinds of the INT warehouse to ECOMMERCE', () => {
    expect(mapRow({ warehouse_symbol: 'INT', kind: 'TOWAR' }, map)).toEqual({ costCenterId: 'PUL', channel: 'ECOMMERCE' })
    expect(mapRow({ warehouse_symbol: 'INT', kind: 'USLUGA' }, map)).toEqual({ costCenterId: 'PUL', channel: 'ECOMMERCE' })
  })

  it('should leave an unknown warehouse unmapped', () => {
    expect(mapRow({ warehouse_symbol: 'ZEW', kind: 'TOWAR' }, map)).toEqual({ costCenterId: null, channel: null })
  })
})

describe('aggregateSnapshots', () => {
  const base = { netAmount: 0, documentCount: 1 }

  it('should sum warehouses that map to the same cell and keep negative corrections', () => {
    const { cells } = aggregateSnapshots([
      { year: 2026, month: 10, warehouseSymbol: 'PUŁ', kind: 'TOWAR', costCenterId: 'PUL', channel: 'SALON', grossAmount: 1000.1, ...base },
      { year: 2026, month: 10, warehouseSymbol: 'PUŁ', kind: 'TOWAR', costCenterId: 'PUL', channel: 'SALON', grossAmount: -250.05, ...base },
    ])
    expect(cells).toEqual([{ year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', grossAmount: 750.05, netAmount: 0, documentCount: 2 }])
  })

  it('should list unmapped rows separately instead of dropping them', () => {
    const { cells, unmapped } = aggregateSnapshots([
      { year: 2026, month: 9, warehouseSymbol: 'ZEW', kind: 'USLUGA', costCenterId: null, channel: null, grossAmount: 99.99, ...base },
    ])
    expect(cells).toEqual([])
    expect(unmapped).toEqual([{ year: 2026, month: 9, warehouseSymbol: 'ZEW', kind: 'USLUGA', grossAmount: 99.99, documentCount: 1 }])
  })

  it('should produce no cell for a month without snapshot rows (absence, not zero)', () => {
    expect(aggregateSnapshots([]).cells).toEqual([])
  })
})

describe('refreshWindow', () => {
  it('should cover the current Warsaw month and the twelve before it', () => {
    expect(refreshWindow(new Date('2026-11-02T10:00:00Z'))).toEqual({ from: '2025-11-01', to: '2026-11-02', fromIndex: 2025 * 12 + 10, toIndex: 2026 * 12 + 10 })
  })

  it('should roll the year boundary in January', () => {
    expect(refreshWindow(new Date('2027-01-15T10:00:00Z')).from).toBe('2026-01-01')
  })

  it('should use the Warsaw date after midnight local time', () => {
    expect(refreshWindow(new Date('2026-10-31T23:30:00Z')).to).toBe('2026-11-01')
  })
})

describe('subiektAsOfDate', () => {
  const now = new Date('2026-11-02T10:00:00Z')

  it('should use today for the current month', () => {
    expect(subiektAsOfDate(2026, 11, now)).toBe('2026-11-02')
  })

  it('should use the last day for a closed month, including February in a leap year', () => {
    expect(subiektAsOfDate(2026, 10, now)).toBe('2026-10-31')
    expect(subiektAsOfDate(2024, 2, now)).toBe('2024-02-29')
  })

  it('should refuse a future month', () => {
    expect(subiektAsOfDate(2026, 12, now)).toBeNull()
  })
})

describe('snapshotSourceHash', () => {
  const row = { year: 2026, month: 10, warehouse_symbol: 'PUŁ', warehouse_name: 'Puławska', kind: 'TOWAR' as const, documents: 3, net_total: 100, gross_total: 123 }

  it('should change when an amount changes and ignore the warehouse display name', () => {
    expect(snapshotSourceHash(row)).toBe(snapshotSourceHash({ ...row, warehouse_name: 'inna' }))
    expect(snapshotSourceHash(row)).not.toBe(snapshotSourceHash({ ...row, gross_total: 123.01 }))
  })
})
