import slugify from 'slugify'

export const CUSTOM_COST_TAG_GROUP_SLUGS: ReadonlySet<string> = new Set(['area', 'role'])

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
      { slug: 'it-software', name: 'Oprogramowanie i usługi IT' },
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
const groupDescriptionBySlug: ReadonlyMap<string, string> = new Map([
  ['behavior', 'Charakter kosztu mówi, jak koszt zachowuje się w raportach: czy buduje stały break-even, zmienia się ze sprzedażą, wchodzi do marży produktu, czy jest jednorazowym odchyleniem.'],
  ['area', 'Obszar to linia produktowa lub część oferty, np. tapety, sztukateria, dywany, montaż albo administracja. Pomaga liczyć koszty i marżę per obszar.'],
  ['role', 'Typ wydatku opisuje rodzaj kosztu. Służy do filtrowania faktur, analiz dostawców i szybkiego sprawdzania, na co firma wydaje pieniądze.'],
  ['supplier-group', 'Relacja z dostawcą rozróżnia stałych i nowych dostawców, żeby łatwiej wyłapać nietypowe faktury lub nowe źródła kosztów.'],
])
const tagDescriptionBySlug: ReadonlyMap<string, string> = new Map([
  ['fixed', 'Stały koszt powtarzalny, zwykle niezależny od bieżącej sprzedaży: czynsz, abonament, licencja, stała obsługa.'],
  ['variable', 'Koszt zmienny, który rośnie lub maleje wraz ze sprzedażą, zleceniami albo liczbą realizacji.'],
  ['cogs', 'Bezpośredni koszt sprzedanych towarów lub materiałów. Ten tag jest kluczowy do liczenia realnej marży.'],
  ['one-off', 'Koszt jednorazowy lub nietypowy. Pokazuje realny wydatek, ale nie powinien zawyżać normalnego miesięcznego break-even.'],
  ['wallpapers', 'Koszty związane z ofertą tapet: zakup, próbki, ekspozycja, materiały i obsługa tej linii.'],
  ['stucco', 'Koszty związane ze sztukaterią: produkty, materiały, wykonanie, ekspozycja i obsługa tej linii.'],
  ['rugs', 'Koszty związane z dywanami: zakup, ekspozycja, logistyka i obsługa tej linii.'],
  ['installation', 'Koszty montażu i realizacji u klienta, w tym wykonawcy, materiały montażowe i dojazdy.'],
  ['administration', 'Koszty ogólne firmy, biura i zaplecza, których nie da się uczciwie przypisać do jednej linii produktowej.'],
  ['contractors', 'Usługi wykonawców zewnętrznych: montażyści, podwykonawcy i osoby realizujące prace dla klientów.'],
  ['goods', 'Zakup towarów i materiałów do sprzedaży lub realizacji zamówień.'],
  ['marketing', 'Reklama, promocja, materiały marketingowe, kampanie i działania pozyskujące klientów.'],
  ['it-software', 'Oprogramowanie i usługi IT, np. Google Workspace, poczta firmowa, domeny, hosting, licencje i narzędzia SaaS.'],
  ['rent', 'Czynsz, najem, opłaty za lokal, magazyn albo powierzchnie wykorzystywane przez firmę.'],
  ['transport', 'Transport, kurierzy, dostawy, przejazdy i logistyka związana z zakupami lub realizacjami.'],
  ['payroll', 'Wynagrodzenia, wypłaty i koszty osobowe. Tag traktuj jako wrażliwy.'],
  ['confidential', 'Koszt poufny lub wrażliwy, którego nie powinny widzieć role bez dostępu administracyjnego.'],
  ['strategic-supplier', 'Stały dostawca, z którym firma regularnie współpracuje i którego faktury powinny mapować się przewidywalnie.'],
  ['new-supplier', 'Nowy lub sporadyczny dostawca wymagający świadomej klasyfikacji przed zatwierdzeniem kosztu.'],
])

export function applyDefaultCostTagLabels(slug: string) {
  return tagBySlug.get(slug)?.name ?? slug
}

function costTagDisplayName(slug: string, fallback: string) {
  return tagBySlug.get(slug)?.name ?? fallback
}

export function applyDefaultCostTagGroupLabel(slug: string, fallback: string) {
  return groupBySlug.get(slug)?.name ?? fallback
}

export function applyDefaultCostTagDescription(slug: string) {
  return tagDescriptionBySlug.get(slug) ?? null
}

export function applyDefaultCostTagGroupDescription(slug: string) {
  return groupDescriptionBySlug.get(slug) ?? null
}

export function canCreateCustomCostTagInGroup(slug: string) {
  return CUSTOM_COST_TAG_GROUP_SLUGS.has(slug)
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
  return buildUniqueCostTagSlug(name, existingSlugs, 'obszar')
}

export function buildUniqueCostTagSlug(name: string, existingSlugs: string[], fallback = 'tag') {
  const existing = new Set(existingSlugs)
  const base = slugify(name.trim(), { lower: true, strict: true, locale: 'pl' }) || fallback
  if (!existing.has(base)) return base

  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
