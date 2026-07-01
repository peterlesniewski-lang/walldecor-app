import slugify from 'slugify'

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

// Axes where the tags are mutually exclusive — a cost is either fixed or
// variable, and a supplier is either recurring or new. The tagging UI enforces
// single selection for these so the user cannot pick contradictory tags.
export const SINGLE_CHOICE_TAG_GROUP_SLUGS: ReadonlySet<string> = new Set(['behavior', 'supplier-group'])

export function isSingleChoiceTagGroup(slug: string) {
  return SINGLE_CHOICE_TAG_GROUP_SLUGS.has(slug)
}

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

function costTagDisplayName(slug: string, fallback: string) {
  return tagBySlug.get(slug)?.name ?? fallback
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
        .map((tag) => ({ ...tag, name: costTagDisplayName(tag.slug, tag.name) }))
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

export function buildUniqueAreaTagSlug(name: string, existingSlugs: string[]) {
  const existing = new Set(existingSlugs)
  const base = slugify(name.trim(), { lower: true, strict: true, locale: 'pl' }) || 'obszar'
  if (!existing.has(base)) return base

  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
