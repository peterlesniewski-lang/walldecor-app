'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calculator, History, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LeaveEntitlementMode } from '@/lib/hr/leave-entitlement'

export interface LeaveEntitlementPanelData {
  config: {
    id: string
    mode: LeaveEntitlementMode
    customAnnualDays: number | null
    employmentFraction: number
    effectiveFrom: string
    note: string | null
    createdAt?: string
    updatedAt?: string
  } | null
  calculatedDays: number | null
  balance: {
    id: string
    year: number
    totalDays: number
    usedDays: number
    pendingDays: number
    carriedOver: number
  } | null
  corrections: Array<{
    id: string
    createdAt: string
    reason: string
    beforeJson?: string
    afterJson?: string
    beforeTotalDays?: number | null
    afterTotalDays?: number | null
  }>
  needsReview: boolean
}

interface LeaveEntitlementPanelProps {
  employeeId: string
  targetYear: number
  maxEffectiveDate: string
  initialData: LeaveEntitlementPanelData
  configurationError?: string | null
}

interface NormalizedFormValues {
  mode: LeaveEntitlementMode
  customAnnualDays: number | null
  employmentFraction: number
  effectiveFrom: string
  note: string | null
  year: number
}

interface PreviewResult {
  calculatedDays: number
  targetTotalDays: number
  currentTotalDays: number
  expectedCurrentTotalDays: number | null
  expectedCurrentCarriedOver: number | null
  expectedConfigVersion: string | null
  deltaDays: number
  requiresCorrection: boolean
}

interface StoredPreview {
  result: PreviewResult
  form: NormalizedFormValues
  version: number
}

const MODES: Array<{ value: LeaveEntitlementMode; label: string }> = [
  { value: 'DAYS_20', label: '20 dni' },
  { value: 'DAYS_26', label: '26 dni' },
  { value: 'CUSTOM', label: 'Własny' },
]

const numberFormatter = new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 2,
})

function formatDays(value: number): string {
  return `${numberFormatter.format(value)} dni`
}

interface FormErrors {
  mode?: string
  customAnnualDays?: string
  employmentFraction?: string
  effectiveFrom?: string
  note?: string
}

function defaultCustomDays(data: LeaveEntitlementPanelData): string {
  if (data.config?.customAnnualDays != null) {
    return String(data.config.customAnnualDays)
  }
  return ''
}

function defaultEffectiveFrom(data: LeaveEntitlementPanelData, year: number): string {
  return data.config?.effectiveFrom.slice(0, 10) ?? `${year}-01-01`
}

function effectiveDateError(
  value: string,
  targetYear: number,
  maxEffectiveDate: string
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'Podaj prawidłową datę obowiązywania.'
  }

  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return 'Podaj prawidłową datę obowiązywania.'
  }

  if (year > targetYear || value > maxEffectiveDate) {
    return `Data nie może być późniejsza niż ${maxEffectiveDate}.`
  }

  return null
}

function parseResponseError(data: unknown, fallback: string): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error
  }
  return fallback
}

function parseResponseCode(data: unknown): string | null {
  if (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof data.code === 'string'
  ) {
    return data.code
  }
  return null
}

function parsePreview(data: unknown): PreviewResult | null {
  if (typeof data !== 'object' || data === null) return null
  const row = data as Record<string, unknown>
  if (
    typeof row.calculatedDays !== 'number' ||
    typeof row.targetTotalDays !== 'number' ||
    typeof row.currentTotalDays !== 'number' ||
    (row.expectedCurrentTotalDays !== null &&
      typeof row.expectedCurrentTotalDays !== 'number') ||
    (row.expectedCurrentCarriedOver !== null &&
      typeof row.expectedCurrentCarriedOver !== 'number') ||
    (row.expectedConfigVersion !== null &&
      typeof row.expectedConfigVersion !== 'string') ||
    typeof row.deltaDays !== 'number' ||
    typeof row.requiresCorrection !== 'boolean'
  ) {
    return null
  }

  return {
    calculatedDays: row.calculatedDays,
    targetTotalDays: row.targetTotalDays,
    currentTotalDays: row.currentTotalDays,
    expectedCurrentTotalDays: row.expectedCurrentTotalDays,
    expectedCurrentCarriedOver: row.expectedCurrentCarriedOver,
    expectedConfigVersion: row.expectedConfigVersion,
    deltaDays: row.deltaDays,
    requiresCorrection: row.requiresCorrection,
  }
}

function parseHistoricalTotal(raw: string | undefined): number | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'totalDays' in parsed &&
      typeof parsed.totalDays === 'number' &&
      Number.isFinite(parsed.totalDays)
    ) {
      return parsed.totalDays
    }
  } catch {
    return null
  }
  return null
}

function historicalTotal(
  normalized: number | null | undefined,
  raw: string | undefined
): number | null {
  return typeof normalized === 'number' && Number.isFinite(normalized)
    ? normalized
    : parseHistoricalTotal(raw)
}

function formatCorrectionDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short' }).format(date)
}

export function LeaveEntitlementPanel({
  employeeId,
  targetYear,
  maxEffectiveDate,
  initialData,
  configurationError = null,
}: LeaveEntitlementPanelProps) {
  const identity = JSON.stringify({
    employeeId,
    targetYear,
    maxEffectiveDate,
    initialData,
    configurationError,
  })

  return (
    <LeaveEntitlementPanelContent
      key={identity}
      employeeId={employeeId}
      targetYear={targetYear}
      maxEffectiveDate={maxEffectiveDate}
      initialData={initialData}
      configurationError={configurationError}
    />
  )
}

function LeaveEntitlementPanelContent({
  employeeId,
  targetYear,
  maxEffectiveDate,
  initialData,
  configurationError = null,
}: LeaveEntitlementPanelProps) {
  const router = useRouter()
  const [mode, setMode] = useState<LeaveEntitlementMode | null>(
    initialData.config?.mode ?? null
  )
  const [customAnnualDays, setCustomAnnualDays] = useState(() => defaultCustomDays(initialData))
  const [employmentFraction, setEmploymentFraction] = useState(() =>
    String(initialData.config?.employmentFraction ?? 1)
  )
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    defaultEffectiveFrom(initialData, targetYear)
  )
  const [note, setNote] = useState(initialData.config?.note ?? '')
  const [preview, setPreview] = useState<StoredPreview | null>(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [pendingAction, setPendingAction] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const formVersionRef = useRef(0)
  const activePreviewRequestRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      formVersionRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!success) return
    const timeoutId = window.setTimeout(() => setSuccess(null), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [success])

  function invalidatePreview() {
    formVersionRef.current += 1
    setPreview(null)
    setCorrectionReason('')
    setPendingAction(null)
    setError(null)
    setSuccess(null)
  }

  function selectMode(nextMode: LeaveEntitlementMode) {
    setMode(nextMode)
    invalidatePreview()
  }

  function validateForm(): {
    normalized: NormalizedFormValues | null
    errors: FormErrors
  } {
    const errors: FormErrors = {}
    if (!mode) {
      errors.mode = 'Wybierz roczny limit.'
    }

    const fraction = Number(employmentFraction)
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      errors.employmentFraction =
        'Wymiar etatu musi być większy od 0 i nie większy niż 1.'
    }

    const dateError = effectiveDateError(
      effectiveFrom,
      targetYear,
      maxEffectiveDate
    )
    if (dateError) errors.effectiveFrom = dateError
    if (note.length > 1000) {
      errors.note = 'Notatka może mieć maksymalnie 1000 znaków.'
    }

    let customDays: number | null = null
    if (mode === 'CUSTOM') {
      customDays = Number(customAnnualDays)
      if (
        !Number.isInteger(customDays) ||
        customDays < 1 ||
        customDays > 365
      ) {
        errors.customAnnualDays =
          'Własny limit musi być liczbą całkowitą od 1 do 365.'
      }
    }

    if (Object.keys(errors).length > 0 || !mode) {
      return { normalized: null, errors }
    }

    return {
      normalized: {
        mode,
        customAnnualDays: customDays,
        employmentFraction: fraction,
        effectiveFrom,
        note: note.trim() || null,
        year: targetYear,
      },
      errors,
    }
  }

  const formValidation = validateForm()
  const normalizedForm = formValidation.normalized
  const reasonLength = correctionReason.trim().length
  const correctionReasonValid =
    !preview?.result.requiresCorrection || (reasonLength >= 3 && reasonLength <= 1000)
  const previewIsCurrent =
    preview !== null && preview.version === formVersionRef.current
  const canApply =
    previewIsCurrent &&
    correctionReasonValid &&
    pendingAction === null

  async function requestPreview() {
    if (!normalizedForm) return
    const formSnapshot = normalizedForm
    const requestVersion = formVersionRef.current + 1
    formVersionRef.current = requestVersion
    activePreviewRequestRef.current = requestVersion
    setPendingAction('preview')
    setError(null)
    setSuccess(null)
    setPreview(null)
    setCorrectionReason('')

    try {
      const response = await fetch(
        `/api/hr/employees/${employeeId}/leave-entitlement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formSnapshot, preview: true }),
        }
      )
      const data: unknown = await response.json().catch(() => null)
      if (
        !mountedRef.current ||
        formVersionRef.current !== requestVersion
      ) {
        return
      }
      if (!response.ok) {
        setError(parseResponseError(data, 'Nie udało się przeliczyć uprawnienia.'))
        return
      }

      const parsedPreview = parsePreview(data)
      if (!parsedPreview) {
        setError('Serwer zwrócił nieprawidłowy podgląd uprawnienia.')
        return
      }
      setPreview({
        result: parsedPreview,
        form: formSnapshot,
        version: requestVersion,
      })
    } catch {
      if (mountedRef.current && formVersionRef.current === requestVersion) {
        setError('Błąd połączenia z serwerem.')
      }
    } finally {
      if (
        mountedRef.current &&
        activePreviewRequestRef.current === requestVersion
      ) {
        activePreviewRequestRef.current = null
        setPendingAction(null)
      }
    }
  }

  async function applyEntitlement() {
    if (!preview || preview.version !== formVersionRef.current || !correctionReasonValid) {
      return
    }
    setPendingAction('apply')
    setError(null)
    setSuccess(null)
    const applyVersion = preview.version

    const payload = {
      ...preview.form,
      preview: false,
      expectedCurrentTotalDays: preview.result.expectedCurrentTotalDays,
      expectedCurrentCarriedOver: preview.result.expectedCurrentCarriedOver,
      expectedConfigVersion: preview.result.expectedConfigVersion,
      ...(preview.result.requiresCorrection
        ? { correctionReason: correctionReason.trim() }
        : {}),
    }

    try {
      const response = await fetch(
        `/api/hr/employees/${employeeId}/leave-entitlement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data: unknown = await response.json().catch(() => null)
      if (
        !mountedRef.current ||
        formVersionRef.current !== applyVersion
      ) {
        return
      }
      if (!response.ok) {
        if (response.status === 409) {
          setPreview(null)
          setCorrectionReason('')
          const code = parseResponseCode(data)
          if (code === 'CONFIG_VERSION_CONFLICT') {
            setError(
              'Konfiguracja zmieniła się od czasu podglądu. Przelicz ponownie.'
            )
          } else if (code === 'CONFIG_DATE_CONFLICT') {
            setError(
              'Data konfiguracji koliduje z aktywnym wpisem. Przelicz ponownie.'
            )
          } else {
            setError('Saldo zmieniło się od czasu podglądu. Przelicz ponownie.')
          }
          return
        }
        setError(parseResponseError(data, 'Nie udało się zapisać uprawnienia.'))
        return
      }

      setPreview(null)
      setCorrectionReason('')
      setSuccess('Zapisano uprawnienie urlopowe.')
      router.refresh()
    } catch {
      if (mountedRef.current && formVersionRef.current === applyVersion) {
        setError('Błąd połączenia z serwerem.')
      }
    } finally {
      if (mountedRef.current && formVersionRef.current === applyVersion) {
        setPendingAction(null)
      }
    }
  }

  const balance = initialData.balance
  const availableDays = balance
    ? balance.totalDays - balance.usedDays - balance.pendingDays
    : null

  return (
    <section
      aria-labelledby="leave-entitlement-heading"
      className="border-b border-[var(--wd-border)] pb-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3
            id="leave-entitlement-heading"
            className="text-base font-semibold text-[var(--wd-text-primary)]"
          >
            Uprawnienie urlopowe {targetYear}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--wd-text-muted)]">
            Urlop wypoczynkowy (VL)
          </p>
        </div>
        {initialData.needsReview ? (
          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            Do weryfikacji
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
            Skonfigurowano
          </span>
        )}
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-[var(--wd-text-muted)]">Aktywny roczny wymiar</span>
        <span
          className={`num font-semibold tabular-nums ${
            initialData.calculatedDays === null
              ? 'text-[var(--wd-text-muted)]'
              : 'text-[var(--wd-text-primary)]'
          }`}
        >
          {initialData.calculatedDays === null
            ? 'Nie wyliczono'
            : formatDays(initialData.calculatedDays)}
        </span>
      </p>

      {configurationError ? (
        <p role="alert" className="mt-4 border-l-2 border-red-300 pl-3 text-sm text-red-700">
          {configurationError}
        </p>
      ) : (
        <>
          {balance ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-[var(--wd-border)] py-3 sm:grid-cols-5">
              {[
                ['Łącznie', balance.totalDays],
                ['Wykorzystane', balance.usedDays],
                ['Oczekujące', balance.pendingDays],
                ['Przeniesione', balance.carriedOver],
                ['Dostępne', availableDays!],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-[var(--wd-text-muted)]">{label}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold tabular-nums text-[var(--wd-text-primary)]">
                    {formatDays(Number(value))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 border-y border-[var(--wd-border)] py-3 text-sm text-[var(--wd-text-muted)]">
              Brak salda VL na {targetYear} rok.
            </p>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label id="leave-entitlement-mode-label">Roczny limit</Label>
              <div
                role="group"
                aria-labelledby="leave-entitlement-mode-label"
                aria-describedby={
                  formValidation.errors.mode
                    ? 'leave-entitlement-mode-error'
                    : undefined
                }
                className="grid h-9 grid-cols-3 rounded-md border border-[var(--wd-border)] bg-[var(--wd-surface-2)] p-0.5"
              >
                {MODES.map((item) => {
                  const selected = mode === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectMode(item.value)}
                      className={`min-w-0 rounded px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1 ${
                        selected
                          ? 'bg-white text-[var(--wd-text-primary)] shadow-sm'
                          : 'text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)]'
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
              {formValidation.errors.mode && (
                <p
                  id="leave-entitlement-mode-error"
                  className="text-xs text-red-700"
                >
                  {formValidation.errors.mode}
                </p>
              )}
            </div>

            {mode === 'CUSTOM' && (
              <div className="space-y-1.5">
                <Label htmlFor="leave-entitlement-custom-days">Własny limit roczny</Label>
                <Input
                  id="leave-entitlement-custom-days"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={customAnnualDays}
                  aria-invalid={Boolean(formValidation.errors.customAnnualDays)}
                  aria-describedby={
                    formValidation.errors.customAnnualDays
                      ? 'leave-entitlement-custom-days-error'
                      : undefined
                  }
                  onChange={(event) => {
                    setCustomAnnualDays(event.target.value)
                    invalidatePreview()
                  }}
                  required
                />
                {formValidation.errors.customAnnualDays && (
                  <p
                    id="leave-entitlement-custom-days-error"
                    className="text-xs text-red-700"
                  >
                    {formValidation.errors.customAnnualDays}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="leave-entitlement-fraction">Wymiar etatu</Label>
              <Input
                id="leave-entitlement-fraction"
                type="number"
                min={0.01}
                max={1}
                step={0.01}
                value={employmentFraction}
                aria-invalid={Boolean(formValidation.errors.employmentFraction)}
                aria-describedby={
                  formValidation.errors.employmentFraction
                    ? 'leave-entitlement-fraction-error'
                    : undefined
                }
                onChange={(event) => {
                  setEmploymentFraction(event.target.value)
                  invalidatePreview()
                }}
                required
              />
              {formValidation.errors.employmentFraction && (
                <p
                  id="leave-entitlement-fraction-error"
                  className="text-xs text-red-700"
                >
                  {formValidation.errors.employmentFraction}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="leave-entitlement-effective-from">Obowiązuje od</Label>
              <Input
                id="leave-entitlement-effective-from"
                type="date"
                max={maxEffectiveDate}
                value={effectiveFrom}
                aria-invalid={Boolean(formValidation.errors.effectiveFrom)}
                aria-describedby={
                  formValidation.errors.effectiveFrom
                    ? 'leave-entitlement-effective-from-error'
                    : undefined
                }
                onChange={(event) => {
                  setEffectiveFrom(event.target.value)
                  invalidatePreview()
                }}
                required
              />
              {formValidation.errors.effectiveFrom && (
                <p
                  id="leave-entitlement-effective-from-error"
                  className="text-xs text-red-700"
                >
                  {formValidation.errors.effectiveFrom}
                </p>
              )}
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="leave-entitlement-note">Notatka (opcjonalnie)</Label>
              <textarea
                id="leave-entitlement-note"
                maxLength={1000}
                rows={2}
                value={note}
                aria-invalid={Boolean(formValidation.errors.note)}
                aria-describedby={
                  formValidation.errors.note
                    ? 'leave-entitlement-note-error'
                    : undefined
                }
                onChange={(event) => {
                  setNote(event.target.value)
                  invalidatePreview()
                }}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              {formValidation.errors.note && (
                <p
                  id="leave-entitlement-note-error"
                  className="text-xs text-red-700"
                >
                  {formValidation.errors.note}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={requestPreview}
              disabled={!normalizedForm || pendingAction !== null}
              className="gap-2"
            >
              {pendingAction === 'preview' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Calculator className="h-3.5 w-3.5" />
              )}
              Przelicz
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={applyEntitlement}
              disabled={!canApply}
              className="gap-2"
            >
              {pendingAction === 'apply' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Zastosuj
            </Button>
          </div>

          {preview && (
            <div aria-live="polite" className="mt-4 border-y border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-3 py-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums text-[var(--wd-text-primary)]">
                <span>Roczny wymiar: {formatDays(preview.result.calculatedDays)}</span>
                {preview.result.expectedCurrentCarriedOver !== null && (
                  <span>
                    Przeniesione:{' '}
                    {formatDays(preview.result.expectedCurrentCarriedOver)}
                  </span>
                )}
                <span>
                  Saldo po zmianie: {formatDays(preview.result.targetTotalDays)}
                </span>
                <span>Aktualne saldo: {formatDays(preview.result.currentTotalDays)}</span>
                <span className="font-medium">
                  Zmiana salda:{' '}
                  {preview.result.deltaDays === 0
                    ? 'bez zmian'
                    : `${preview.result.deltaDays > 0 ? '+' : ''}${numberFormatter.format(preview.result.deltaDays)} dni`}
                </span>
              </div>

              {preview.result.requiresCorrection && (
                <div className="mt-3 max-w-xl space-y-1.5">
                  <Label htmlFor="leave-entitlement-correction-reason">Powód korekty</Label>
                  <Input
                    id="leave-entitlement-correction-reason"
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 border-l-2 border-red-300 pl-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="mt-4 border-l-2 border-emerald-300 pl-3 text-sm text-emerald-700">
              {success}
            </p>
          )}

          <div className="mt-6 border-t border-[var(--wd-border)] pt-5">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--wd-text-muted)]" />
              <h4 className="text-sm font-semibold text-[var(--wd-text-primary)]">
                Historia korekt
              </h4>
            </div>
            {initialData.corrections.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--wd-text-muted)]">Brak korekt.</p>
            ) : (
              <div className="mt-2 divide-y divide-[var(--wd-border)]">
                {initialData.corrections.map((correction) => {
                  const before = historicalTotal(
                    correction.beforeTotalDays,
                    correction.beforeJson
                  )
                  const after = historicalTotal(
                    correction.afterTotalDays,
                    correction.afterJson
                  )
                  return (
                    <div
                      key={correction.id}
                      className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--wd-text-primary)]">
                          {correction.reason}
                        </p>
                        <p className="text-xs text-[var(--wd-text-muted)]">
                          {formatCorrectionDate(correction.createdAt)}
                        </p>
                      </div>
                      <span className="num whitespace-nowrap text-sm tabular-nums text-[var(--wd-text-primary)]">
                        {before === null ? '—' : numberFormatter.format(before)} →{' '}
                        {after === null ? '—' : `${numberFormatter.format(after)} dni`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
