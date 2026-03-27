'use client'
import { useState, useRef } from 'react'
import Papa from 'papaparse'

// ─── Types ────────────────────────────────────────────────────────────────────

type DataModule = 'costs' | 'revenue'
type CostsType = 'budget' | 'actuals'
type RevenueType = 'plan' | 'actuals'
type Step = 'upload' | 'map' | 'done'

interface FieldMapping {
  mode: 'column' | 'constant'
  value: string
}

interface ImportResult {
  imported: number
  errors: { row: number; message: string }[]
}

interface Props {
  userRole: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COSTS_FIELDS = ['rok', 'miesiac', 'centrum_kosztow', 'kategoria', 'podkategoria', 'kwota'] as const
const REVENUE_FIELDS = ['rok', 'miesiac', 'centrum_kosztow', 'kanal', 'kwota'] as const

const FIELD_LABELS: Record<string, string> = {
  rok: 'Rok',
  miesiac: 'Miesiąc',
  centrum_kosztow: 'Centrum kosztów',
  kategoria: 'Kategoria',
  podkategoria: 'Podkategoria',
  kanal: 'Kanał',
  kwota: 'Kwota',
}

const FIELD_HINTS: Record<string, string> = {
  rok: '2020–2100',
  miesiac: '1–12',
  centrum_kosztow: 'JAG / PUL / GLOBAL',
  kategoria: 'nazwa kategorii z systemu',
  podkategoria: 'nazwa podkategorii z systemu',
  kanal: 'SALON / MONTAZ / ECOMMERCE',
  kwota: 'liczba ≥ 0, przecinek lub kropka',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "1 234,50 PLN" → "1234.50" */
function normalizeKwota(raw: string): string {
  let s = raw.trim().replace(/[^\d,.\-]/g, '')
  if (s.includes(',') && s.includes('.')) {
    // both present → comma is thousands separator
    s = s.replace(/,/g, '')
  } else {
    s = s.replace(',', '.')
  }
  return s
}

function applyMapping(
  row: Record<string, string>,
  fields: readonly string[],
  mapping: Record<string, FieldMapping>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const field of fields) {
    const m = mapping[field]
    if (!m) { result[field] = ''; continue }
    const raw = m.mode === 'column' ? (row[m.value] ?? '') : m.value
    result[field] = field === 'kwota' ? normalizeKwota(raw) : raw.trim()
  }
  return result
}

function buildInitialMapping(
  fields: readonly string[],
  headers: string[]
): Record<string, FieldMapping> {
  const mapping: Record<string, FieldMapping> = {}
  for (const field of fields) {
    const exact = headers.find((h) => h.toLowerCase() === field.toLowerCase())
    mapping[field] = exact
      ? { mode: 'column', value: exact }
      : { mode: 'column', value: '' }
  }
  return mapping
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CsvColumnMapper({ userRole }: Props) {
  const isAdmin = userRole === 'ADMIN'
  const canImport = isAdmin || userRole === 'MANAGER'

  // Module + type
  const [module, setModule] = useState<DataModule>('costs')
  const [costsType, setCostsType] = useState<CostsType>('actuals')
  const [revenueType, setRevenueType] = useState<RevenueType>('actuals')

  // CSV state
  const [step, setStep] = useState<Step>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, FieldMapping>>({})

  // Import state
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const fields = module === 'costs' ? COSTS_FIELDS : REVENUE_FIELDS
  const dataType = module === 'costs' ? costsType : revenueType
  const apiPath = module === 'costs' ? '/api/import/costs' : '/api/import/revenue'

  // Auth: for budget/plan type only admin can import
  const canImportThisType =
    dataType === 'budget' || dataType === 'plan' ? isAdmin : canImport

  // ── File upload ──────────────────────────────────────────────────────────────

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    setResult(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const detectedHeaders = res.meta.fields ?? []
        if (detectedHeaders.length === 0) {
          setParseError('Nie wykryto nagłówków w pliku CSV.')
          return
        }
        setHeaders(detectedHeaders)
        setRows(res.data)
        setFileName(file.name)
        setMapping(buildInitialMapping(fields, detectedHeaders))
        setStep('map')
      },
      error: (err) => setParseError(err.message),
    })
  }

  const reset = () => {
    setStep('upload')
    setHeaders([])
    setRows([])
    setFileName('')
    setParseError(null)
    setMapping({})
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Mapping update ───────────────────────────────────────────────────────────

  const setFieldMode = (field: string, mode: 'column' | 'constant') => {
    setMapping((prev) => ({ ...prev, [field]: { mode, value: '' } }))
  }

  const setFieldValue = (field: string, value: string) => {
    setMapping((prev) => ({ ...prev, [field]: { ...prev[field], value } }))
  }

  // ── Validation of mapping completeness ──────────────────────────────────────

  const missingFields = fields.filter((f) => !mapping[f]?.value)

  // ── Preview rows ─────────────────────────────────────────────────────────────

  const previewRows = rows.slice(0, 3).map((row) => applyMapping(row, fields, mapping))

  // ── Import ───────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    setImporting(true)
    setResult(null)

    const transformed = rows.map((row) => applyMapping(row, fields, mapping))

    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: dataType, rows: transformed }),
      })
      const data: ImportResult = await res.json()
      setResult(data)
      setStep('done')
    } catch {
      setParseError('Błąd połączenia z serwerem.')
    } finally {
      setImporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Module + type selectors — always visible */}
      <div className="flex flex-wrap gap-4 items-start">
        {/* Module */}
        <div className="space-y-1">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Moduł</p>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {(['costs', 'revenue'] as DataModule[]).map((m) => (
              <button
                key={m}
                onClick={() => { setModule(m); reset() }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  module === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m === 'costs' ? 'Koszty' : 'Przychody'}
              </button>
            ))}
          </div>
        </div>

        {/* Type */}
        <div className="space-y-1">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Typ danych</p>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {module === 'costs'
              ? (['actuals', 'budget'] as CostsType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setCostsType(t); reset() }}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      costsType === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'budget' ? 'Plan budżetowy' : 'Wykonanie'}
                  </button>
                ))
              : (['actuals', 'plan'] as RevenueType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setRevenueType(t); reset() }}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      revenueType === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'plan' ? 'Plan sprzedaży' : 'Wykonanie'}
                  </button>
                ))}
          </div>
        </div>
      </div>

      {!canImportThisType && (
        <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
          Import {dataType === 'budget' || dataType === 'plan' ? 'planu' : 'wykonania'} wymaga roli{' '}
          {dataType === 'budget' || dataType === 'plan' ? 'ADMIN' : 'ADMIN lub MANAGER'}.
        </div>
      )}

      {/* ── Step: upload ── */}
      {step === 'upload' && canImportThisType && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 w-fit px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-[var(--wd-sand)] hover:text-gray-700 cursor-pointer transition-colors">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Wgraj dowolny plik CSV — zmapujesz kolumny w następnym kroku
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </label>
          {parseError && (
            <p className="text-sm text-red-600">{parseError}</p>
          )}
        </div>
      )}

      {/* ── Step: map ── */}
      {step === 'map' && (
        <div className="space-y-5">
          {/* File info + reset */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="font-medium text-gray-700">{fileName}</span>
            <span className="text-gray-400">— {rows.length} wierszy, {headers.length} kolumn</span>
            <button onClick={reset} className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2">
              zmień plik
            </button>
          </div>

          {/* Mapping table */}
          <div className="rounded-xl border border-[var(--wd-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--wd-surface-2)' }}>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-gray-400 w-40">
                    Pole w systemie
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-gray-400">
                    Źródło
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-gray-400 w-48">
                    Podgląd (wiersz 1)
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, i) => {
                  const m = mapping[field] ?? { mode: 'column', value: '' }
                  const preview = previewRows[0]?.[field] ?? '—'
                  const isEmpty = !m.value
                  return (
                    <tr
                      key={field}
                      className="border-t"
                      style={{ borderColor: 'var(--wd-border)', background: i % 2 === 1 ? 'color-mix(in srgb, var(--wd-surface-2) 40%, transparent)' : undefined }}
                    >
                      {/* Field name */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{FIELD_LABELS[field]}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{FIELD_HINTS[field]}</div>
                      </td>

                      {/* Source selector */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {/* Mode toggle */}
                          <div className="flex gap-1 text-xs">
                            <button
                              onClick={() => setFieldMode(field, 'column')}
                              className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                                m.mode === 'column'
                                  ? 'border-[var(--wd-sand)] bg-[var(--wd-sand)] text-gray-800'
                                  : 'border-gray-200 text-gray-400 hover:border-gray-300'
                              }`}
                            >
                              kolumna CSV
                            </button>
                            <button
                              onClick={() => setFieldMode(field, 'constant')}
                              className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                                m.mode === 'constant'
                                  ? 'border-[var(--wd-sand)] bg-[var(--wd-sand)] text-gray-800'
                                  : 'border-gray-200 text-gray-400 hover:border-gray-300'
                              }`}
                            >
                              stała wartość
                            </button>
                          </div>

                          {/* Value input */}
                          {m.mode === 'column' ? (
                            <select
                              value={m.value}
                              onChange={(e) => setFieldValue(field, e.target.value)}
                              className={`px-2 py-1.5 text-sm border rounded-lg outline-none bg-white transition-colors ${
                                isEmpty
                                  ? 'border-amber-300 focus:border-amber-400'
                                  : 'border-gray-200 focus:border-[var(--wd-sand)]'
                              }`}
                            >
                              <option value="">— wybierz kolumnę —</option>
                              {headers.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={m.value}
                              onChange={(e) => setFieldValue(field, e.target.value)}
                              placeholder={`stała wartość...`}
                              className={`px-2 py-1.5 text-sm border rounded-lg outline-none transition-colors ${
                                isEmpty
                                  ? 'border-amber-300 focus:border-amber-400'
                                  : 'border-gray-200 focus:border-[var(--wd-sand)]'
                              }`}
                            />
                          )}
                        </div>
                      </td>

                      {/* Preview */}
                      <td className="px-4 py-3">
                        <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                          isEmpty
                            ? 'text-amber-500 bg-amber-50'
                            : preview
                              ? 'text-gray-700 bg-gray-100'
                              : 'text-gray-300'
                        }`}>
                          {isEmpty ? 'nie zmapowane' : preview || '(puste)'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Preview table (3 rows) */}
          {missingFields.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">
                Podgląd po transformacji (pierwsze 3 wiersze)
              </p>
              <div className="overflow-x-auto rounded-lg border border-[var(--wd-border)]">
                <table className="text-xs w-full">
                  <thead>
                    <tr style={{ background: 'var(--wd-surface-2)' }}>
                      {fields.map((f) => (
                        <th key={f} className="px-3 py-2 text-left font-medium text-gray-400">{f}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: 'var(--wd-border)' }}>
                        {fields.map((f) => (
                          <td key={f} className="px-3 py-1.5 font-mono text-gray-600">{row[f] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warnings */}
          {missingFields.length > 0 && (
            <p className="text-xs text-amber-600">
              Uzupełnij mapowanie dla: {missingFields.map((f) => FIELD_LABELS[f]).join(', ')}
            </p>
          )}

          {parseError && (
            <p className="text-sm text-red-600">{parseError}</p>
          )}

          {/* Import button */}
          <button
            onClick={handleImport}
            disabled={importing || missingFields.length > 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[var(--wd-dark)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {importing ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            Importuj {rows.length} wierszy
          </button>
        </div>
      )}

      {/* ── Step: done ── */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className={`px-4 py-3 rounded-xl border text-sm space-y-2 ${
            result.errors.length === 0
              ? 'bg-green-50 border-green-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <p className={`font-semibold ${result.errors.length === 0 ? 'text-green-700' : 'text-amber-700'}`}>
              Zaimportowano {result.imported} z {rows.length} wierszy
              {result.errors.length > 0 && ` — ${result.errors.length} błędów`}
            </p>
            {result.errors.length > 0 && (
              <ul className="text-xs space-y-0.5 text-amber-600">
                {result.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>Wiersz {e.row}: {e.message}</li>
                ))}
                {result.errors.length > 8 && (
                  <li>... i {result.errors.length - 8} więcej</li>
                )}
              </ul>
            )}
          </div>
          <button
            onClick={reset}
            className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            Importuj kolejny plik
          </button>
        </div>
      )}
    </div>
  )
}
