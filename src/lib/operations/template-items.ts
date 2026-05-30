export interface TemplateItemDraft {
  id?: string
  title: string
  description?: string | null
  order: number
  procedureId?: string | null
  defaultOwnerId?: string | null
  dueDayOffset?: number | null
}

export interface NormalizedTemplateItem {
  title: string
  description: string | null
  order: number
  procedureId: string | null
  defaultOwnerId: string | null
  dueDayOffset: number | null
}

function cleanOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function normalizeTemplateItems(items: TemplateItemDraft[]): NormalizedTemplateItem[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      title: item.title.trim(),
      description: cleanOptionalString(item.description),
      order: index + 1,
      procedureId: cleanOptionalString(item.procedureId),
      defaultOwnerId: cleanOptionalString(item.defaultOwnerId),
      dueDayOffset: item.dueDayOffset ?? null,
    }))
}
