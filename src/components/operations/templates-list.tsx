import Link from 'next/link'
import { ClipboardList } from 'lucide-react'

interface TemplateListItem {
  id: string
  name: string
  description: string | null
  active: boolean
  module: {
    name: string
    area: { name: string }
  }
  _count: {
    items: number
    runs: number
  }
}

export function TemplatesList({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-sm text-gray-500">
        Brak szablonów. Po seedzie pojawi się tu „Księgowość - koniec miesiąca”.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {templates.map((template) => (
        <Link
          key={template.id}
          href={`/operations/templates/${template.id}`}
          className="rounded-xl border bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-900">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {template.module.area.name} / {template.module.name}
              </p>
              <h3 className="mt-1 font-semibold text-gray-900">{template.name}</h3>
              {template.description && (
                <p className="mt-1 line-clamp-2 text-sm text-gray-500">{template.description}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-2 text-xs text-gray-500">
            <span>{template._count.items} zadań</span>
            <span>•</span>
            <span>{template._count.runs} wykonań</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
