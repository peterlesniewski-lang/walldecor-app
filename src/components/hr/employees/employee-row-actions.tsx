'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface EmployeeRowActionsProps {
  employeeId: string
  employeeName: string
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl border border-[var(--wd-border)] p-6 w-full max-w-md">
        <h2 className="text-base font-semibold text-[var(--wd-text-primary)] mb-2">{title}</h2>
        <p className="text-sm text-[var(--wd-text-muted)] mb-6">{description}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
              destructive
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E]'
            }`}
          >
            {loading ? 'Proszę czekać…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EmployeeRowActions({ employeeId, employeeName }: EmployeeRowActionsProps) {
  const router = useRouter()
  const [dialog, setDialog] = useState<'hide' | 'delete' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleHide() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Błąd podczas ukrywania pracownika')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd')
    } finally {
      setLoading(false)
      setDialog(null)
    }
  }

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Błąd podczas usuwania pracownika')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd')
    } finally {
      setLoading(false)
      setDialog(null)
    }
  }

  return (
    <>
      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 shadow-lg max-w-sm">
          {error}
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-transparent hover:border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
            aria-label="Akcje"
          >
            <svg className="w-4 h-4 text-[var(--wd-text-muted)]" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={`/hr/employees/${employeeId}`} className="flex items-center gap-2 cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Podgląd
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/hr/employees/${employeeId}/edit`} className="flex items-center gap-2 cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edytuj
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDialog('hide')}
            className="flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
            Ukryj
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDialog('delete')}
            className="flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Usuń
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={dialog === 'hide'}
        title="Ukryj pracownika"
        description={`Pracownik ${employeeName} zostanie ukryty z listy. Dane historyczne zostaną zachowane.`}
        confirmLabel="Ukryj"
        loading={loading}
        onConfirm={handleHide}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        title="Usuń pracownika"
        description={`Czy na pewno chcesz trwale usunąć pracownika ${employeeName}? Pracownicy z danymi historycznymi nie mogą zostać usunięci.`}
        confirmLabel="Usuń trwale"
        destructive
        loading={loading}
        onConfirm={handleDelete}
        onCancel={() => setDialog(null)}
      />
    </>
  )
}
