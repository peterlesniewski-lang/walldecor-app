'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { employeeUpdateSchema } from '@/lib/hr/schemas'
import { EMPLOYMENT_TYPES } from '@/lib/hr/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

type UpdateSchema = z.infer<typeof employeeUpdateSchema>

// Form uses string dates; server coerces them. avatarUrl is added here as it
// is a valid Employee field but not yet part of employeeUpdateSchema.
type FormValues = Omit<UpdateSchema, 'startDate' | 'endDate'> & {
  startDate?: string
  endDate?: string
  avatarUrl?: string
}

interface Division {
  id: string
  name: string
}

interface Department {
  id: string
  name: string
  divisionId: string
}

interface Position {
  id: string
  name: string
}

interface Manager {
  id: string
  firstName: string
  lastName: string
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  employmentType: string | null
  divisionId: string | null
  departmentId: string | null
  positionId: string | null
  managerId: string | null
  startDate: Date
  endDate: Date | null
  costCenterId: string
  avatarUrl: string | null
  position: string
}

interface EmployeeEditFormProps {
  employee: Employee
  divisions: Division[]
  departments: Department[]
  positions: Position[]
  managers: Manager[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] outline-none focus:ring-2 focus:ring-[var(--wd-sand)] focus:border-[var(--wd-sand)] transition-all placeholder:text-[var(--wd-text-muted)]'

const selectClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] outline-none focus:ring-2 focus:ring-[var(--wd-sand)] focus:border-[var(--wd-sand)] transition-all disabled:opacity-50 disabled:cursor-not-allowed'

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold uppercase tracking-wide text-[var(--wd-text-muted)] mb-1.5"
    >
      {children}
    </label>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h3 className="text-sm font-semibold text-[var(--wd-text-primary)] whitespace-nowrap">
        {children}
      </h3>
      <div className="flex-1 h-px bg-[var(--wd-border)]" />
    </div>
  )
}

function toDateString(d: Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toISOString().split('T')[0]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmployeeEditForm({
  employee,
  divisions,
  departments,
  positions,
  managers,
}: EmployeeEditFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(
      employeeUpdateSchema.omit({ startDate: true, endDate: true }).extend({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        avatarUrl: z.string().optional(),
      })
    ),
    defaultValues: {
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone ?? '',
      employmentType: (employee.employmentType as (typeof EMPLOYMENT_TYPES)[number] | undefined) ?? undefined,
      positionId: employee.positionId ?? '',
      divisionId: employee.divisionId ?? '',
      departmentId: employee.departmentId ?? '',
      managerId: employee.managerId ?? '',
      startDate: toDateString(employee.startDate),
      endDate: toDateString(employee.endDate),
      costCenterId: employee.costCenterId,
      avatarUrl: employee.avatarUrl ?? '',
      position: employee.position,
    },
  })

  const selectedDivisionId = watch('divisionId')
  const filteredDepartments = departments.filter(
    (d) => !selectedDivisionId || d.divisionId === selectedDivisionId
  )

  async function onSubmit(data: FormValues) {
    setServerError(null)

    // Strip empty strings → undefined so PATCH only sends changed fields
    const payload: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== '' && value !== undefined) {
        payload[key] = value
      } else if (value === '') {
        // Send null for optional relational fields to clear them
        const nullableFields = ['phone', 'positionId', 'divisionId', 'departmentId', 'managerId', 'avatarUrl', 'endDate']
        if (nullableFields.includes(key)) {
          payload[key] = null
        }
      }
    }

    try {
      const res = await fetch(`/api/hr/employees/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Błąd podczas zapisywania zmian')
      }

      router.push(`/hr/employees/${employee.id}`)
      router.refresh()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Nieznany błąd')
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href={`/hr/employees/${employee.id}`}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors flex-shrink-0"
        >
          <svg
            className="w-4 h-4 text-[var(--wd-text-primary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">
            Edytuj pracownika
          </h1>
          <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            {employee.firstName} {employee.lastName}
          </p>
        </div>
      </div>

      {/* ── Form card ── */}
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm p-6 lg:p-8 space-y-8">

          {/* ─ Dane podstawowe ─ */}
          <section>
            <SectionTitle>Dane podstawowe</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">Imię</Label>
                <input
                  id="firstName"
                  {...register('firstName')}
                  className={inputClass}
                  placeholder="Jan"
                />
                <FieldError message={errors.firstName?.message} />
              </div>
              <div>
                <Label htmlFor="lastName">Nazwisko</Label>
                <input
                  id="lastName"
                  {...register('lastName')}
                  className={inputClass}
                  placeholder="Kowalski"
                />
                <FieldError message={errors.lastName?.message} />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <input
                  id="email"
                  type="email"
                  {...register('email')}
                  className={inputClass}
                  placeholder="jan.kowalski@walldecor.pl"
                />
                <FieldError message={errors.email?.message} />
              </div>
              <div>
                <Label htmlFor="phone">Telefon</Label>
                <input
                  id="phone"
                  type="tel"
                  {...register('phone')}
                  className={inputClass}
                  placeholder="+48 500 000 000"
                />
                <FieldError message={errors.phone?.message} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="avatarUrl">URL awatara</Label>
                <input
                  id="avatarUrl"
                  type="url"
                  {...register('avatarUrl')}
                  className={inputClass}
                  placeholder="https://..."
                />
                <FieldError message={errors.avatarUrl?.message} />
              </div>
            </div>
          </section>

          {/* ─ Zatrudnienie ─ */}
          <section>
            <SectionTitle>Zatrudnienie</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="employmentType">Typ umowy</Label>
                <select
                  id="employmentType"
                  {...register('employmentType')}
                  className={selectClass}
                >
                  <option value="">Wybierz typ</option>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'UoP'
                        ? 'UoP — Umowa o pracę'
                        : t === 'B2B'
                        ? 'B2B'
                        : t === 'UZ'
                        ? 'UZ — Umowa zlecenie'
                        : t === 'UoD'
                        ? 'UoD — Umowa o dzieło'
                        : 'Inne'}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.employmentType?.message} />
              </div>
              <div>
                <Label htmlFor="costCenterId">Centrum kosztów</Label>
                <select
                  id="costCenterId"
                  {...register('costCenterId')}
                  className={selectClass}
                >
                  <option value="">Wybierz centrum</option>
                  <option value="JAG">JAG — Jagodowa</option>
                  <option value="PUL">PUL — Puławska</option>
                  <option value="GLOBAL">GLOBAL</option>
                </select>
                <FieldError message={errors.costCenterId?.message} />
              </div>
              <div>
                <Label htmlFor="startDate">Data zatrudnienia</Label>
                <input
                  id="startDate"
                  type="date"
                  {...register('startDate')}
                  className={inputClass}
                />
                <FieldError message={errors.startDate?.message} />
              </div>
              <div>
                <Label htmlFor="endDate">Data zakończenia</Label>
                <input
                  id="endDate"
                  type="date"
                  {...register('endDate')}
                  className={inputClass}
                />
                <FieldError message={errors.endDate?.message} />
              </div>
            </div>
          </section>

          {/* ─ Struktura organizacyjna ─ */}
          <section>
            <SectionTitle>Struktura organizacyjna</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="positionId">Stanowisko (katalog)</Label>
                <select
                  id="positionId"
                  {...register('positionId')}
                  className={selectClass}
                >
                  <option value="">Wybierz stanowisko</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.positionId?.message} />
              </div>
              <div>
                <Label htmlFor="position">Stanowisko (wyświetlane)</Label>
                <input
                  id="position"
                  {...register('position')}
                  className={inputClass}
                  placeholder="np. Sprzedawca, Koordynator"
                />
                <FieldError message={errors.position?.message} />
              </div>
              <div>
                <Label htmlFor="divisionId">Oddział</Label>
                <select
                  id="divisionId"
                  {...register('divisionId')}
                  className={selectClass}
                >
                  <option value="">Brak / wybierz</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.divisionId?.message} />
              </div>
              <div>
                <Label htmlFor="departmentId">Dział</Label>
                <select
                  id="departmentId"
                  {...register('departmentId')}
                  className={selectClass}
                  disabled={!selectedDivisionId}
                >
                  <option value="">Brak / wybierz</option>
                  {filteredDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.departmentId?.message} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="managerId">Przełożony</Label>
                <select
                  id="managerId"
                  {...register('managerId')}
                  className={selectClass}
                >
                  <option value="">Brak</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.managerId?.message} />
              </div>
            </div>
          </section>

          {/* ─ Error banner ─ */}
          {serverError && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
              <svg
                className="w-4 h-4 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {serverError}
            </div>
          )}
        </div>

        {/* ── Action bar ── */}
        <div className="flex items-center justify-between pt-6">
          <Link
            href={`/hr/employees/${employee.id}`}
            className="px-5 py-2.5 text-sm font-medium rounded-lg border border-[var(--wd-border)] text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            Anuluj
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg bg-[#1E1E1E] text-white hover:bg-[#2E2E2E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 12 0 12 0v4a8 8 0 00-8 8H4z"
                  />
                </svg>
                Zapisywanie…
              </>
            ) : (
              'Zapisz zmiany'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
