import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COST_TAG_GROUPS,
  applyDefaultCostTagLabels,
  buildUniqueAreaTagSlug,
  sortCostTagGroupsForDisplay,
} from '@/lib/finance/cost-tags'

describe('cost tag taxonomy', () => {
  it('keeps stable reporting slugs but exposes Polish business labels', () => {
    expect(DEFAULT_COST_TAG_GROUPS).toEqual([
      {
        group: { slug: 'behavior', name: 'Charakter kosztu', order: 10 },
        tags: [
          { slug: 'fixed', name: 'Stały' },
          { slug: 'variable', name: 'Zmienny' },
          { slug: 'cogs', name: 'Koszt sprzedanych towarów' },
          { slug: 'one-off', name: 'Jednorazowy' },
        ],
      },
      {
        group: { slug: 'area', name: 'Obszar', order: 20 },
        tags: [
          { slug: 'wallpapers', name: 'Tapety' },
          { slug: 'stucco', name: 'Sztukateria' },
          { slug: 'rugs', name: 'Dywany' },
          { slug: 'installation', name: 'Montaż' },
          { slug: 'administration', name: 'Administracja' },
        ],
      },
      {
        group: { slug: 'role', name: 'Typ wydatku', order: 30 },
        tags: [
          { slug: 'contractors', name: 'Wykonawcy' },
          { slug: 'goods', name: 'Zakup towarów i materiałów' },
          { slug: 'marketing', name: 'Marketing' },
          { slug: 'rent', name: 'Czynsz i najem' },
          { slug: 'transport', name: 'Transport' },
          { slug: 'payroll', name: 'Wynagrodzenia' },
          { slug: 'confidential', name: 'Poufne' },
        ],
      },
      {
        group: { slug: 'supplier-group', name: 'Relacja z dostawcą', order: 40 },
        tags: [
          { slug: 'strategic-supplier', name: 'Stały dostawca' },
          { slug: 'new-supplier', name: 'Nowy dostawca' },
        ],
      },
    ])
  })

  it('sorts database tag groups by business order and applies default labels by slug', () => {
    const groups = sortCostTagGroupsForDisplay([
      {
        id: 'role',
        slug: 'role',
        name: 'Rola',
        tags: [
          { id: 'payroll', slug: 'payroll', name: 'payroll' },
          { id: 'goods', slug: 'goods', name: 'goods' },
          { id: 'contractors', slug: 'contractors', name: 'contractors' },
          { id: 'custom-fabrics', slug: 'fabrics', name: 'Tkaniny' },
        ],
      },
      {
        id: 'behavior',
        slug: 'behavior',
        name: 'Charakter kosztu',
        tags: [
          { id: 'one-off', slug: 'one-off', name: 'one-off' },
          { id: 'fixed', slug: 'fixed', name: 'fixed' },
        ],
      },
    ])

    expect(groups.map((group) => group.name)).toEqual(['Charakter kosztu', 'Typ wydatku'])
    expect(groups[0].tags.map((tag) => tag.name)).toEqual(['Stały', 'Jednorazowy'])
    expect(groups[1].tags.map((tag) => tag.name)).toEqual([
      'Wykonawcy',
      'Zakup towarów i materiałów',
      'Wynagrodzenia',
      'Tkaniny',
    ])
  })

  it('prepares seed rows from the same taxonomy used by the UI', () => {
    expect(applyDefaultCostTagLabels('strategic-supplier')).toBe('Stały dostawca')
    expect(applyDefaultCostTagLabels('unknown-custom-tag')).toBe('unknown-custom-tag')
  })

  it('builds stable unique slugs for user-managed area tags', () => {
    expect(buildUniqueAreaTagSlug('Żaluzje i rolety', [])).toBe('zaluzje-i-rolety')
    expect(buildUniqueAreaTagSlug('Tapety', ['tapety'])).toBe('tapety-2')
    expect(buildUniqueAreaTagSlug('Tapety', ['tapety', 'tapety-2'])).toBe('tapety-3')
  })
})
