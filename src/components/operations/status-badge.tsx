const LABELS: Record<string, string> = {
  todo: 'Do zrobienia',
  in_progress: 'W toku',
  blocked: 'Bloker',
  done: 'Gotowe',
  open: 'Otwarte',
  closed: 'Zamknięte',
  archived: 'Archiwum',
}

const CLASSES: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  blocked: 'bg-red-100 text-red-700',
  done: 'bg-green-100 text-green-700',
  open: 'bg-blue-100 text-blue-700',
  closed: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-600',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${CLASSES[status] ?? CLASSES.todo}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
