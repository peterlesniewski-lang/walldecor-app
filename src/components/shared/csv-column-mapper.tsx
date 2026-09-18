'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import styles from './revenue-ui.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type DataModule = 'costs' | 'revenue'
type CostsType = 'budget' | 'actuals'
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
const REVENUE_FIELDS = ['rok', 'miesiac', 'centrum_kosztow', 'kanal', 'kwota', 'stan_na_dzien'] as const

const FIELD_LABELS: Record<string, string> = {
  rok: 'Rok',
  miesiac: 'Miesiąc',
  centrum_kosztow: 'Centrum kosztów',
  kategoria: 'Kategoria',
  podkategoria: 'Podkategoria',
  kanal: 'Kanał',
  kwota: 'Kwota',
  stan_na_dzien: 'Stan na dzień (opcjonalnie)',
}

const FIELD_HINTS: Record<string, string> = {
  rok: '2020–2100',
  miesiac: '1–12',
  centrum_kosztow: 'JAG / PUL / GLOBAL',
  kategoria: 'nazwa kategorii z systemu',
  podkategoria: 'nazwa podkategorii z systemu',
  kanal: 'SALON / MONTAZ / ECOMMERCE',
  kwota: 'liczba ≥ 0, przecinek lub kropka',
  stan_na_dzien: 'RRRR-MM-DD; brak daty usuwa poprzednią informację o aktualności',
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
    result[field] = field === 'kwota' && fields.includes('kategoria') ? normalizeKwota(raw) : raw.trim()
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
  const router = useRouter()
  const isAdmin = userRole === 'ADMIN'
  const canImport = isAdmin

  // Module + type
  const [module, setModule] = useState<DataModule>('costs')
  const [costsType, setCostsType] = useState<CostsType>('actuals')

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
  const dataType = module === 'costs' ? costsType : 'actuals'
  const apiPath = module === 'costs' ? '/api/import/costs' : '/api/import/revenue'

  const canImportThisType = dataType === 'budget' ? isAdmin : canImport

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

  const missingFields = fields.filter((f) => f !== 'stan_na_dzien' && !mapping[f]?.value)

  // ── Preview rows ─────────────────────────────────────────────────────────────

  const previewRows = rows.slice(0, 3).map((row) => applyMapping(row, fields, mapping))

  // ── Import ───────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    setImporting(true)
    setResult(null)
    setParseError(null)

    const transformed = rows.map((row) => applyMapping(row, fields, mapping))

    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: dataType, rows: transformed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Nie udało się zaimportować danych.')
      setResult({ imported: data.imported ?? 0, errors: data.errors ?? [] })
      setStep('done')
      if (data.imported > 0) router.refresh()
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : 'Błąd połączenia z serwerem.')
    } finally {
      setImporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`${styles.theme} ${styles.stack}`}>

      {/* Module + type selectors — always visible */}
      <div className={styles.toolbar}>
        {/* Module */}
        <div className={styles.compactStack}>
          <p className={styles.eyebrow}>Moduł</p>
          <div className={styles.segmented}>
            {(['costs', 'revenue'] as DataModule[]).map((m) => (
              <Button
                key={m}
                onClick={() => { setModule(m); reset() }}
                className={styles.segment} aria-pressed={module === m}
              >
                {m === 'costs' ? 'Koszty' : 'Przychody'}
              </Button>
            ))}
          </div>
        </div>

        {/* Type */}
        <div className={styles.compactStack}>
          <p className={styles.eyebrow}>Typ danych</p>
          <div className={styles.segmented}>
            {module === 'costs'
              ? (['actuals', 'budget'] as CostsType[]).map((t) => (
                  <Button
                    key={t}
                    onClick={() => { setCostsType(t); reset() }}
                    className={styles.segment} aria-pressed={costsType === t}
                  >
                    {t === 'budget' ? 'Plan budżetowy' : 'Wykonanie'}
                  </Button>
                ))
              : <span className={styles.segmentLabel}>Rzeczywiste obroty brutto</span>}
          </div>
        </div>
      </div>

      {!canImportThisType && (
        <div className={styles.warning}>
          Import {dataType === 'budget' ? 'budżetu kosztów' : 'wykonania'} wymaga roli{' '}
          ADMIN.
        </div>
      )}

      {/* ── Step: upload ── */}
      {step === 'upload' && canImportThisType && (
        <div className={styles.compactStack}>
          <label className={styles.upload}>
            <svg className={styles.icon} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Wgraj dowolny plik CSV — zmapujesz kolumny w następnym kroku
            <input ref={fileRef} type="file" accept=".csv" className="sr-only" onChange={handleFile} />
          </label>
          {parseError && (
            <p role="alert" className={styles.error}>{parseError}</p>
          )}
        </div>
      )}

      {/* ── Step: map ── */}
      {step === 'map' && (
        <div className={styles.stack}>
          {/* File info + reset */}
          <div className={styles.fileInfo}>
            <svg className={styles.icon} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className={styles.strong}>{fileName}</span>
            <span>— {rows.length} wierszy, {headers.length} kolumn</span>
            <Button onClick={reset} className={styles.textButton}>
              zmień plik
            </Button>
          </div>

          {/* Mapping table */}
          <div className={styles.tableShell}>
            <table className={`${styles.table} ${styles.mappingTable}`}>
              <thead>
                <tr>
                  <th>
                    Pole w systemie
                  </th>
                  <th>
                    Źródło
                  </th>
                  <th>
                    Podgląd (wiersz 1)
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const m = mapping[field] ?? { mode: 'column', value: '' }
                  const preview = previewRows[0]?.[field] ?? '—'
                  const isEmpty = !m.value && field !== 'stan_na_dzien'
                  return (
                    <tr key={field}>
                      {/* Field name */}
                      <td>
                        <div className={styles.strong}>{FIELD_LABELS[field]}</div>
                        <div className={styles.help}>{field === 'kwota' && module === 'revenue' ? 'Kwota brutto narastająco po korektach; może być ujemna' : FIELD_HINTS[field]}</div>
                      </td>

                      {/* Source selector */}
                      <td>
                        <div className={styles.compactStack}>
                          {/* Mode toggle */}
                          <div className={styles.tabs}>
                            <Button
                              onClick={() => setFieldMode(field, 'column')}
                              className={styles.segment} aria-pressed={m.mode === 'column'}
                            >
                              kolumna CSV
                            </Button>
                            <Button
                              onClick={() => setFieldMode(field, 'constant')}
                              className={styles.segment} aria-pressed={m.mode === 'constant'}
                            >
                              stała wartość
                            </Button>
                          </div>

                          {/* Value input */}
                          {m.mode === 'column' ? (
                            <select
                              value={m.value}
                              aria-label={`Kolumna CSV: ${FIELD_LABELS[field]}`}
                              onChange={(e) => setFieldValue(field, e.target.value)}
                              className={`${styles.input} ${isEmpty ? styles.inputMissing : ''}`}
                            >
                              <option value="">— wybierz kolumnę —</option>
                              {headers.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              type="text"
                              value={m.value}
                              aria-label={`Stała wartość: ${FIELD_LABELS[field]}`}
                              onChange={(e) => setFieldValue(field, e.target.value)}
                              placeholder={`stała wartość...`}
                              className={`${styles.input} ${isEmpty ? styles.inputMissing : ''}`}
                            />
                          )}
                        </div>
                      </td>

                      {/* Preview */}
                      <td>
                        <span className={`${styles.previewValue} ${isEmpty ? styles.previewMissing : ''}`}>
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
            <div className={styles.compactStack}>
              <p className={styles.eyebrow}>
                Podgląd po transformacji (pierwsze 3 wiersze)
              </p>
              <div className={styles.tableShell}>
                <table className={`${styles.table} ${styles.previewTable}`}>
                  <thead>
                    <tr>
                      {fields.map((f) => (
                        <th key={f}>{f}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {fields.map((f) => (
                          <td key={f}>{row[f] || '—'}</td>
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
            <p className={styles.warning}>
              Uzupełnij mapowanie dla: {missingFields.map((f) => FIELD_LABELS[f]).join(', ')}
            </p>
          )}

          {parseError && (
            <p role="alert" className={styles.error}>{parseError}</p>
          )}

          {/* Import button */}
          <Button
            onClick={handleImport}
            disabled={importing || missingFields.length > 0}
            aria-busy={importing}
            className={`${styles.button} ${styles.primary}`}
          >
            {!importing && (
              <svg className={styles.icon} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            {importing ? 'Importowanie…' : `Importuj ${rows.length} wierszy`}
          </Button>
        </div>
      )}

      {/* ── Step: done ── */}
      {step === 'done' && result && (
        <div className={styles.stack}>
          <div role="status" className={result.errors.length === 0 ? styles.status : styles.warning}>
            <p className={styles.strong}>
              Zaimportowano {result.imported} z {rows.length} wierszy
              {result.errors.length > 0 && ` — ${result.errors.length} błędów`}
            </p>
            {result.errors.length > 0 && (
              <ul className={styles.resultList}>
                {result.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>Wiersz {e.row}: {e.message}</li>
                ))}
                {result.errors.length > 8 && (
                  <li>... i {result.errors.length - 8} więcej</li>
                )}
              </ul>
            )}
          </div>
          <Button
            onClick={reset}
            className={styles.textButton}
          >
            Importuj kolejny plik
          </Button>
        </div>
      )}
    </div>
  )
}
