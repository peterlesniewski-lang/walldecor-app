import type { InstallationVisitSyncState } from '@/lib/installations/visit-service'

const statusPresentation: Record<string, { label: string; className: string }> = {
  NOT_REQUESTED: { label: 'Nie wysłano', className: 'border-stone-200 bg-stone-100 text-stone-700' },
  PENDING: { label: 'Oczekuje', className: 'border-amber-200 bg-amber-50 text-amber-900' },
  SYNCED: { label: 'W Google Calendar', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  ATTENTION: { label: 'Wymaga uwagi', className: 'border-red-200 bg-red-50 text-red-800' },
}

export function InstallationCalendarStatus({ syncState }: { syncState: Pick<InstallationVisitSyncState, 'status'> }) {
  const presentation = statusPresentation[syncState.status] ?? { label: 'Nieznany status', className: 'border-stone-200 bg-stone-100 text-stone-700' }

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${presentation.className}`}>{presentation.label}</span>
}
