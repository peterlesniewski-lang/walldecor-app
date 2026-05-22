import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { BookOpenCheck, ClipboardList, ListChecks } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getOperationModules, getRuns } from '@/lib/operations/queries'
import { RunsList } from '@/components/operations/runs-list'

export default async function OperationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [areas, runs] = await Promise.all([getOperationModules(), getRuns()])
  const activeRuns = runs.filter((run) => run.status === 'open').slice(0, 5)

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
            <ListChecks className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Operacje</h1>
            <p className="text-sm text-gray-500">Procedury, checklisty i wykonania procesów firmowych.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/operations/procedures" className="rounded-lg border bg-white px-3 py-2 text-sm font-medium">
            Procedury
          </Link>
          <Link href="/operations/templates" className="rounded-lg border bg-white px-3 py-2 text-sm font-medium">
            Szablony
          </Link>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Link href="/operations/procedures" className="rounded-xl border bg-white p-5 hover:shadow-sm">
          <BookOpenCheck className="mb-4 h-6 w-6 text-gray-700" />
          <h2 className="font-semibold text-gray-900">Procedury</h2>
          <p className="mt-1 text-sm text-gray-500">How-to dla zadań, bazujące na edytorze Encyklopedii.</p>
        </Link>
        <Link href="/operations/templates" className="rounded-xl border bg-white p-5 hover:shadow-sm">
          <ClipboardList className="mb-4 h-6 w-6 text-gray-700" />
          <h2 className="font-semibold text-gray-900">Szablony</h2>
          <p className="mt-1 text-sm text-gray-500">Stałe listy zadań, np. księgowość na koniec miesiąca.</p>
        </Link>
        <Link href="/operations/runs" className="rounded-xl border bg-white p-5 hover:shadow-sm">
          <ListChecks className="mb-4 h-6 w-6 text-gray-700" />
          <h2 className="font-semibold text-gray-900">Wykonania</h2>
          <p className="mt-1 text-sm text-gray-500">Konkretne miesiące i procesy z postępem wykonania.</p>
        </Link>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 font-semibold text-gray-900">Aktywne wykonania</h2>
        <RunsList runs={activeRuns} />
      </div>

      <div>
        <h2 className="mb-3 font-semibold text-gray-900">Moduły operacyjne</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {areas.map((area) => (
            <div key={area.id} className="rounded-xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{area.name}</p>
              <div className="mt-3 grid gap-2">
                {area.modules.map((module) => (
                  <div key={module.id} className="rounded-lg bg-gray-50 p-3">
                    <h3 className="font-medium text-gray-900">{module.name}</h3>
                    {module.description && <p className="mt-1 text-sm text-gray-500">{module.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
