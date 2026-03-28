'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { employeeCreateSchema } from '@/lib/hr/schemas'

// We use string dates in the form (HTML inputs return strings) and let the server coerce them
type FormPayload = Omit<z.infer<typeof employeeCreateSchema>, 'startDate' | 'endDate'> & {
  startDate: string
  endDate?: string
}

// Per-step schemas for validation
const step1Schema = z.object({
  firstName: z.string().min(1, 'Imię jest wymagane').max(100),
  lastName: z.string().min(1, 'Nazwisko jest wymagane').max(100),
  email: z.string().email('Nieprawidłowy adres email'),
  phone: z.string().optional(),
})

const step2Schema = z.object({
  employmentType: z.enum(['UoP', 'B2B', 'UZ', 'UoD', 'inne'] as const).optional(),
  startDate: z.string().min(1, 'Data rozpoczęcia jest wymagana'),
  endDate: z.string().optional(),
  costCenterId: z.string().min(1, 'Centrum kosztów jest wymagane'),
  position: z.string().min(1, 'Stanowisko jest wymagane').max(100),
})

const step3Schema = z.object({
  divisionId: z.string().optional(),
  departmentId: z.string().optional(),
  managerId: z.string().optional(),
})

type Step1 = z.infer<typeof step1Schema>
type Step2 = z.infer<typeof step2Schema>
type Step3 = z.infer<typeof step3Schema>

interface Division { id: string; name: string }
interface Department { id: string; name: string; divisionId: string }
interface Manager { id: string; firstName: string; lastName: string }

interface EmployeeFormProps {
  divisions: Division[]
  departments: Department[]
  managers: Manager[]
}

const STEPS = ['Dane osobowe', 'Zatrudnienie', 'Struktura']

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-all ${
              i < current
                ? 'bg-[var(--wd-dark)] text-white'
                : i === current
                  ? 'bg-[var(--wd-sand)] text-[var(--wd-dark)] ring-2 ring-[var(--wd-dark)] ring-offset-2'
                  : 'bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)]'
            }`}
          >
            {i < current ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          {i < total - 1 && (
            <div
              className={`h-0.5 w-16 mx-1 transition-all ${i < current ? 'bg-[var(--wd-dark)]' : 'bg-[var(--wd-border)]'}`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}

function Label({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--wd-text-primary)] mb-1">
      {children}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
  )
}

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] outline-none focus:ring-2 focus:ring-[var(--wd-sand)] focus:border-[var(--wd-sand)] transition-all'

export function EmployeeForm({ divisions, departments, managers }: EmployeeFormProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [stepData, setStepData] = useState<Partial<FormPayload>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1
  const form1 = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '' },
  })

  // Step 2
  const form2 = useForm<Step2>({
    resolver: zodResolver(step2Schema),
    defaultValues: { position: '', costCenterId: '' },
  })

  // Step 3
  const form3 = useForm<Step3>({
    resolver: zodResolver(step3Schema),
    defaultValues: {},
  })

  const selectedDivisionId = form3.watch('divisionId')
  const filteredDepartments = departments.filter((d) => !selectedDivisionId || d.divisionId === selectedDivisionId)

  async function handleStep1(data: Step1) {
    setStepData((prev) => ({ ...prev, ...data }))
    setStep(1)
  }

  async function handleStep2(data: Step2) {
    setStepData((prev) => ({ ...prev, ...data }))
    setStep(2)
  }

  async function handleStep3(data: Step3) {
    // Strip empty strings from optional FK fields — Prisma rejects "" as a foreign key
    const cleaned: Step3 = {
      divisionId: data.divisionId || undefined,
      departmentId: data.departmentId || undefined,
      managerId: data.managerId || undefined,
    }
    const finalData = { ...stepData, ...cleaned } as FormPayload
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/hr/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalData),
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Błąd podczas tworzenia pracownika')
      }

      const employee = await res.json()
      router.push(`/hr/employees/${employee.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nieznany błąd')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <StepIndicator current={step} total={STEPS.length} />

      {/* Step label */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--wd-text-primary)]">{STEPS[step]}</h2>
        <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
          Krok {step + 1} z {STEPS.length}
        </p>
      </div>

      {/* Step 1 */}
      {step === 0 && (
        <form onSubmit={form1.handleSubmit(handleStep1)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName" required>Imię</Label>
              <input id="firstName" {...form1.register('firstName')} className={inputClass} placeholder="Jan" />
              <FieldError message={form1.formState.errors.firstName?.message} />
            </div>
            <div>
              <Label htmlFor="lastName" required>Nazwisko</Label>
              <input id="lastName" {...form1.register('lastName')} className={inputClass} placeholder="Kowalski" />
              <FieldError message={form1.formState.errors.lastName?.message} />
            </div>
          </div>
          <div>
            <Label htmlFor="email" required>Email</Label>
            <input id="email" type="email" {...form1.register('email')} className={inputClass} placeholder="jan.kowalski@walldecor.pl" />
            <FieldError message={form1.formState.errors.email?.message} />
          </div>
          <div>
            <Label htmlFor="phone">Telefon</Label>
            <input id="phone" type="tel" {...form1.register('phone')} className={inputClass} placeholder="+48 500 000 000" />
          </div>
          <FormNav onBack={() => router.back()} canBack={false} isSubmitting={false} isLast={false} />
        </form>
      )}

      {/* Step 2 */}
      {step === 1 && (
        <form onSubmit={form2.handleSubmit(handleStep2)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="employmentType">Typ umowy</Label>
              <select id="employmentType" {...form2.register('employmentType')} className={inputClass}>
                <option value="">Wybierz typ</option>
                <option value="UoP">UoP — Umowa o pracę</option>
                <option value="B2B">B2B</option>
                <option value="UZ">UZ — Umowa zlecenie</option>
                <option value="UoD">UoD — Umowa o dzieło</option>
                <option value="inne">Inne</option>
              </select>
            </div>
            <div>
              <Label htmlFor="costCenterId" required>Centrum kosztów</Label>
              <select id="costCenterId" {...form2.register('costCenterId')} className={inputClass}>
                <option value="">Wybierz centrum</option>
                <option value="JAG">JAG — Jagiellońska</option>
                <option value="PUL">PUL — Puławska</option>
                <option value="GLOBAL">GLOBAL</option>
              </select>
              <FieldError message={form2.formState.errors.costCenterId?.message} />
            </div>
          </div>
          <div>
            <Label htmlFor="position" required>Stanowisko</Label>
            <input id="position" {...form2.register('position')} className={inputClass} placeholder="np. Sprzedawca, Koordynator" />
            <FieldError message={form2.formState.errors.position?.message} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startDate" required>Data rozpoczęcia</Label>
              <input id="startDate" type="date" {...form2.register('startDate')} className={inputClass} />
              <FieldError message={form2.formState.errors.startDate?.message} />
            </div>
            <div>
              <Label htmlFor="endDate">Data zakończenia</Label>
              <input id="endDate" type="date" {...form2.register('endDate')} className={inputClass} />
            </div>
          </div>
          <FormNav onBack={() => setStep(0)} canBack isSubmitting={false} isLast={false} />
        </form>
      )}

      {/* Step 3 */}
      {step === 2 && (
        <form onSubmit={form3.handleSubmit(handleStep3)} className="space-y-4">
          <div>
            <Label htmlFor="divisionId">Oddział</Label>
            <select id="divisionId" {...form3.register('divisionId')} className={inputClass}>
              <option value="">Wybierz oddział</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="departmentId">Dział</Label>
            <select id="departmentId" {...form3.register('departmentId')} className={inputClass} disabled={!selectedDivisionId}>
              <option value="">Wybierz dział</option>
              {filteredDepartments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="managerId">Przełożony</Label>
            <select id="managerId" {...form3.register('managerId')} className={inputClass}>
              <option value="">Brak / wybierz</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
          )}

          <FormNav onBack={() => setStep(1)} canBack isSubmitting={isSubmitting} isLast />
        </form>
      )}
    </div>
  )
}

function FormNav({
  onBack,
  canBack,
  isSubmitting,
  isLast,
}: {
  onBack: () => void
  canBack: boolean
  isSubmitting: boolean
  isLast: boolean
}) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-[var(--wd-border)] mt-6">
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        Wstecz
      </button>
      <button
        type="submit"
        disabled={isSubmitting}
        className="px-5 py-2 text-sm font-medium rounded-lg bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E] transition-colors disabled:opacity-60"
      >
        {isSubmitting ? 'Zapisywanie...' : isLast ? 'Utwórz pracownika' : 'Dalej'}
      </button>
    </div>
  )
}
