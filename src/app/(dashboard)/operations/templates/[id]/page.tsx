import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getTemplate } from '@/lib/operations/queries'
import { StartRunButton } from '@/components/operations/start-run-button'

export default async function OperationTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const template = await getTemplate(id)
  if (!template) notFound()

  const canStart = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
            <ClipboardList className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {template.module.area.name} / {template.module.name}
            </p>
            <h1 className="text-xl font-bold text-gray-900">{template.name}</h1>
            {template.description && <p className="mt-1 text-sm text-gray-500">{template.description}</p>}
          </div>
        </div>
        {canStart && <StartRunButton templateId={template.id} />}
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b p-4">
          <h2 className="font-semibold text-gray-900">Zadania w szablonie</h2>
        </div>
        <div className="divide-y">
          {template.items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                {item.order}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-gray-900">{item.title}</h3>
                {item.description && <p className="mt-1 text-sm text-gray-500">{item.description}</p>}
                {item.procedureId && (
                  <span className="mt-2 inline-block text-xs font-medium text-blue-600">
                    Podpięta procedura
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
