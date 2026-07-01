export const DEFAULT_COST_TAG_GROUPS = [
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
] as const

const groupBySlug: ReadonlyMap<string, { name: string; order: number }> = new Map(
  DEFAULT_COST_TAG_GROUPS.map((group) => [group.group.slug, group.group])
)
const tagBySlug: ReadonlyMap<string, { name: string }> = new Map(
  DEFAULT_COST_TAG_GROUPS.flatMap((group) => group.tags.map((tag) => [tag.slug, tag] as const))
)
const groupOrderBySlug: ReadonlyMap<string, number> = new Map(
  DEFAULT_COST_TAG_GROUPS.map((group, index) => [group.group.slug, index])
)
const tagOrderBySlug: ReadonlyMap<string, number> = new Map(
  DEFAULT_COST_TAG_GROUPS.flatMap((group) => group.tags.map((tag, index) => [tag.slug, index] as const))
)

export function applyDefaultCostTagLabels(slug: string) {
  return tagBySlug.get(slug)?.name ?? slug
}

export function applyDefaultCostTagGroupLabel(slug: string, fallback: string) {
  return groupBySlug.get(slug)?.name ?? fallback
}

export function defaultCostTagOrder(slug: string) {
  return tagOrderBySlug.get(slug) ?? Number.MAX_SAFE_INTEGER
}

export function defaultCostTagGroupOrder(slug: string) {
  return groupOrderBySlug.get(slug) ?? Number.MAX_SAFE_INTEGER
}

export function sortCostTagGroupsForDisplay<
  TGroup extends { slug: string; name: string; tags: TTag[] },
  TTag extends { slug: string; name: string },
>(groups: TGroup[]) {
  return groups
    .map((group) => ({
      ...group,
      name: applyDefaultCostTagGroupLabel(group.slug, group.name),
      tags: [...group.tags]
        .map((tag) => ({ ...tag, name: applyDefaultCostTagLabels(tag.slug) }))
        .sort((a, b) => defaultCostTagOrder(a.slug) - defaultCostTagOrder(b.slug) || a.name.localeCompare(b.name, 'pl')),
    }))
    .sort((a, b) => defaultCostTagGroupOrder(a.slug) - defaultCostTagGroupOrder(b.slug) || a.name.localeCompare(b.name, 'pl'))
}

export function defaultCostTagSeedRows() {
  return DEFAULT_COST_TAG_GROUPS.map((group) => ({
    group: group.group,
    tags: group.tags,
  }))
}
