'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, ChevronDown, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type InstallationEmployeeOption = {
  id: string
  firstName: string
  lastName: string
}

export type InstallationOrderFormValue = {
  id: string
  client: { name: string; email: string; phone: string }
  addressStreet: string
  addressBuildingNumber: string | null
  addressApartmentNumber: string | null
  addressPostalCode: string
  addressCity: string
  primaryEmployeeId: string
  backupEmployeeId: string
}

type OwnerPickerProps = {
  triggerLabel: string
  ownerRoleLabel: string
  value: string
  employees: InstallationEmployeeOption[]
  disabledEmployeeId?: string
  disabled?: boolean
  onChange: (employeeId: string) => void
}

function EmployeePicker({ triggerLabel, ownerRoleLabel, value, employees, disabledEmployeeId, disabled = false, onChange }: OwnerPickerProps) {
  const [open, setOpen] = useState(false)
  const selected = employees.find((employee) => employee.id === value)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-left text-sm font-medium transition hover:border-stone-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)', color: 'var(--wd-dark)' }}
      >
        <span>{selected ? `${selected.firstName} ${selected.lastName}` : triggerLabel}</span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-10 mt-2 w-full overflow-hidden rounded-lg border p-1"
          style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.14)', boxShadow: '0 10px 24px rgba(30, 30, 30, 0.12)' }}
        >
          {employees.map((employee) => {
            const disabled = employee.id === disabledEmployeeId
            return (
              <button
                key={employee.id}
                type="button"
                role="option"
                aria-selected={employee.id === value}
                aria-label={`Ustaw ${employee.firstName} ${employee.lastName} jako ${ownerRoleLabel}`}
                disabled={disabled}
                onClick={() => {
                  onChange(employee.id)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: 'var(--wd-dark)' }}
              >
                <span>{employee.firstName} {employee.lastName}</span>
                {employee.id === value && <Check className="h-4 w-4" style={{ color: '#8C5718' }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function fieldError(errors: Record<string, string>, field: string) {
  return errors[field]
}

export function InstallationOrderForm({
  mode,
  employees,
  order,
  onSaved,
  primaryEmployeeIdLocked,
  canManageOwners = mode === 'create',
}: {
  mode: 'create' | 'edit'
  employees: InstallationEmployeeOption[]
  order?: InstallationOrderFormValue
  onSaved?: () => void
  primaryEmployeeIdLocked?: string
  /** Named owners are changed only through the audited governance panel after creation. */
  canManageOwners?: boolean
}) {
  const router = useRouter()
  const initial = useMemo(() => ({
    clientName: order?.client.name ?? '',
    email: order?.client.email ?? '',
    phone: order?.client.phone ?? '',
    street: order?.addressStreet ?? '',
    buildingNumber: order?.addressBuildingNumber ?? '',
    apartmentNumber: order?.addressApartmentNumber ?? '',
    postalCode: order?.addressPostalCode ?? '',
    city: order?.addressCity ?? '',
    primaryEmployeeId: primaryEmployeeIdLocked ?? order?.primaryEmployeeId ?? '',
    backupEmployeeId: order?.backupEmployeeId ?? '',
  }), [order, primaryEmployeeIdLocked])
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    setMessage('')
    const payload = {
      client: { name: form.clientName, email: form.email, phone: form.phone },
      address: {
        street: form.street,
        buildingNumber: form.buildingNumber || (mode === 'edit' ? null : undefined),
        apartmentNumber: form.apartmentNumber || (mode === 'edit' ? null : undefined),
        postalCode: form.postalCode,
        city: form.city,
      },
      ...((mode === 'create' || canManageOwners) ? {
        primaryEmployeeId: primaryEmployeeIdLocked ?? form.primaryEmployeeId,
        backupEmployeeId: form.backupEmployeeId,
      } : {}),
    }

    try {
      const endpoint = mode === 'create' ? '/api/installations' : `/api/installations/${order?.id}`
      const response = await fetch(endpoint, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) {
        setErrors(result.fieldErrors ?? {})
        setMessage(result.error ?? 'Nie udało się zapisać karty.')
        return
      }
      if (mode === 'create') {
        router.push(`/installations/${result.id}`)
      } else {
        setMessage('Wszystko zapisane')
        onSaved?.()
        router.refresh()
      }
    } catch {
      setMessage('Nie udało się połączyć z serwerem. Spróbuj ponownie.')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = { background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl" noValidate>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="data-label">{mode === 'create' ? 'Nowe zlecenie' : 'Edycja karty'}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>
            {mode === 'create' ? 'Utwórz kartę montażu' : 'Dane zlecenia'}
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Najpierw klient i miejsce. Potem dwie osoby, które naprawdę odpowiadają za dalszy przebieg.
          </p>
        </div>
        {mode === 'create' && (
          <Button type="button" variant="outline" onClick={() => router.push('/installations')} aria-label="Wróć do kart montaży">
            <ArrowLeft /> Wróć
          </Button>
        )}
      </div>

      <div className="space-y-5">
        <section className="rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <p className="data-label" style={{ color: '#8C5718' }}>01 · Klient</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="installation-client">Klient</Label>
              <Input id="installation-client" aria-invalid={Boolean(fieldError(errors, 'client.name'))} value={form.clientName} onChange={(event) => updateField('clientName', event.target.value)} style={inputStyle} />
              {fieldError(errors, 'client.name') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'client.name')}</p>}
            </div>
            <div>
              <Label htmlFor="installation-email">E-mail</Label>
              <Input id="installation-email" type="email" aria-invalid={Boolean(fieldError(errors, 'client.email'))} value={form.email} onChange={(event) => updateField('email', event.target.value)} style={inputStyle} />
              {fieldError(errors, 'client.email') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'client.email')}</p>}
            </div>
            <div>
              <Label htmlFor="installation-phone">Telefon</Label>
              <Input id="installation-phone" type="tel" aria-invalid={Boolean(fieldError(errors, 'client.phone'))} value={form.phone} onChange={(event) => updateField('phone', event.target.value)} style={inputStyle} />
              {fieldError(errors, 'client.phone') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'client.phone')}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <p className="data-label" style={{ color: '#8C5718' }}>02 · Miejsce montażu</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <Label htmlFor="installation-street">Ulica</Label>
              <Input id="installation-street" aria-invalid={Boolean(fieldError(errors, 'address.street'))} value={form.street} onChange={(event) => updateField('street', event.target.value)} style={inputStyle} />
              {fieldError(errors, 'address.street') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'address.street')}</p>}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="installation-building">Numer budynku</Label>
              <Input id="installation-building" value={form.buildingNumber} onChange={(event) => updateField('buildingNumber', event.target.value)} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="installation-apartment">Numer lokalu</Label>
              <Input id="installation-apartment" value={form.apartmentNumber} onChange={(event) => updateField('apartmentNumber', event.target.value)} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="installation-postal-code">Kod pocztowy</Label>
              <Input id="installation-postal-code" inputMode="numeric" placeholder="00-000" aria-invalid={Boolean(fieldError(errors, 'address.postalCode'))} value={form.postalCode} onChange={(event) => updateField('postalCode', event.target.value)} style={inputStyle} />
              {fieldError(errors, 'address.postalCode') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'address.postalCode')}</p>}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="installation-city">Miejscowość</Label>
              <Input id="installation-city" aria-invalid={Boolean(fieldError(errors, 'address.city'))} value={form.city} onChange={(event) => updateField('city', event.target.value)} style={inputStyle} />
              {fieldError(errors, 'address.city') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'address.city')}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
          <p className="data-label" style={{ color: '#8C5718' }}>03 · Odpowiedzialność</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Karta wymaga dwóch różnych aktywnych pracowników. Zastępca nie jest opcją awaryjną — jest widoczną odpowiedzialnością.</p>
          {mode === 'create' || canManageOwners ? <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Główny opiekun</Label>
              <div className="mt-2">
                <EmployeePicker triggerLabel="Wybierz głównego opiekuna" ownerRoleLabel="głównego opiekuna" value={form.primaryEmployeeId} employees={employees} disabled={Boolean(primaryEmployeeIdLocked)} disabledEmployeeId={form.backupEmployeeId} onChange={(value) => updateField('primaryEmployeeId', value)} />
              </div>
              {fieldError(errors, 'primaryEmployeeId') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'primaryEmployeeId')}</p>}
            </div>
            <div>
              <Label>Zastępca opiekuna</Label>
              <div className="mt-2">
                <EmployeePicker triggerLabel="Wybierz zastępcę opiekuna" ownerRoleLabel="zastępcę opiekuna" value={form.backupEmployeeId} employees={employees} disabledEmployeeId={form.primaryEmployeeId} onChange={(value) => updateField('backupEmployeeId', value)} />
              </div>
              {fieldError(errors, 'backupEmployeeId') && <p className="mt-1 text-xs text-red-700">{fieldError(errors, 'backupEmployeeId')}</p>}
            </div>
          </div> : <p className="mt-4 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Zmianę opiekuna, zastępcy i czasowe zastępstwo zapisuje administrator lub manager w audytowanej sekcji poniżej.</p>}
        </section>
      </div>

      {message && <p role="status" className="mt-4 text-sm font-medium" style={{ color: message === 'Wszystko zapisane' ? '#356B43' : '#9F2D24' }}>{message}</p>}
      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={saving} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}>
          <Save /> {saving ? 'Zapisywanie…' : mode === 'create' ? 'Utwórz kartę' : 'Zapisz zmiany'}
        </Button>
      </div>
    </form>
  )
}
