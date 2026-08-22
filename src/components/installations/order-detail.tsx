'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArrowLeft, MapPin, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InstallationOrderForm, type InstallationEmployeeOption, type InstallationOrderFormValue } from './order-form'
import { RoomScopeEditor } from './room-scope-editor'

type InstallationOrderDetailValue = InstallationOrderFormValue & {
  number: string
  status: string
  archivedAt: Date | string | null
  primaryEmployee: { firstName: string; lastName: string }
  backupEmployee: { firstName: string; lastName: string }
}

export function InstallationOrderDetail({
  order,
  employees,
  canEdit = false,
  canArchive = false,
  rooms = [],
  catalog = [],
}: {
  order: InstallationOrderDetailValue
  employees: InstallationEmployeeOption[]
  canEdit?: boolean
  canArchive?: boolean
  rooms?: Parameters<typeof RoomScopeEditor>[0]['initialRooms']
  catalog?: Parameters<typeof RoomScopeEditor>[0]['catalog']
}) {
  const router = useRouter()
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')

  async function archive() {
    setArchiving(true)
    setError('')
    try {
      const response = await fetch(`/api/installations/${order.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json()
        setError(result.error ?? 'Nie udało się zarchiwizować zlecenia.')
        return
      }
      router.push('/installations')
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/installations" className="inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4" style={{ color: '#8C5718' }}>
            <ArrowLeft className="h-4 w-4" /> Wróć do kart
          </Link>
          <p className="num mt-5 text-xs font-bold tracking-wide" style={{ color: '#8C5718' }}>{order.number}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>{order.client.name}</h1>
        </div>
        {canArchive && !order.archivedAt && (
          <Button type="button" variant="outline" onClick={archive} disabled={archiving} className="min-h-11 border-red-200 text-red-800 hover:bg-red-50">
            <Archive /> {archiving ? 'Archiwizowanie…' : 'Archiwizuj zlecenie'}
          </Button>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}><MapPin className="h-4 w-4" style={{ color: '#8C5718' }} /> Miejsce montażu</div>
          <p className="mt-3 text-sm" style={{ color: 'var(--wd-text-muted)' }}>{order.addressStreet} {order.addressBuildingNumber}{order.addressApartmentNumber ? `/${order.addressApartmentNumber}` : ''}, {order.addressPostalCode} {order.addressCity}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}><UsersRound className="h-4 w-4" style={{ color: '#8C5718' }} /> Odpowiedzialność</div>
          <p className="mt-3 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Opiekun: {order.primaryEmployee.firstName} {order.primaryEmployee.lastName}</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Zastępca: {order.backupEmployee.firstName} {order.backupEmployee.lastName}</p>
        </div>
      </div>

      {order.archivedAt ? (
        <p className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.12)', color: 'var(--wd-dark)' }}>
          Karta jest zarchiwizowana. Historia i odpowiedzialność pozostają zachowane.
        </p>
      ) : canEdit ? (
        <InstallationOrderForm mode="edit" order={order} employees={employees} />
      ) : null}
      <RoomScopeEditor orderId={order.id} initialRooms={rooms} catalog={catalog} canEdit={canEdit} />
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </div>
  )
}
