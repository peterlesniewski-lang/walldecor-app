'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import styles from './revenue-ui.module.css'

interface CsvRevenuePanelProps {
  userRole: string
}

interface CsvRow {
  rok: string
  miesiac: string
  centrum_kosztow: string
  kanal: string
  kwota: string
  [key: string]: string
}

interface ImportResult {
  imported: number
  errors: { row: number; message: string }[]
}

const CURRENT_YEAR = new Date().getFullYear()
const CSV_FIELDS = ['rok', 'miesiac', 'centrum_kosztow', 'kanal', 'kwota', 'stan_na_dzien']

export function CsvRevenuePanel({ userRole }: CsvRevenuePanelProps) {
  const router = useRouter()
  const isAdmin = userRole === 'ADMIN'
  const canImportActuals = isAdmin

  const [exportYear, setExportYear] = useState<string>(String(CURRENT_YEAR))
  const [exportCostCenter, setExportCostCenter] = useState<string>('')
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const canEditType = canImportActuals

  const handleExport = () => {
    const params = new URLSearchParams({ type: 'actuals' })
    if (exportYear) params.set('year', exportYear)
    if (exportCostCenter) params.set('costCenterId', exportCostCenter)
    window.location.href = `/api/export/revenue?${params}`
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setImportResult(null)
    setParseError(null)
    setParsedRows([])

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const required = ['rok', 'miesiac', 'centrum_kosztow', 'kanal', 'kwota']
        const headers = results.meta.fields ?? []
        const missing = required.filter((h) => !headers.includes(h))
        if (missing.length > 0) {
          setParseError(`Brakujące kolumny: ${missing.join(', ')}`)
          return
        }
        setParsedRows(results.data)
      },
      error: (err) => setParseError(err.message),
    })
  }

  const handleImport = async () => {
    if (parsedRows.length === 0) return
    setImporting(true)
    setImportResult(null)
    setParseError(null)

    try {
      const res = await fetch('/api/import/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'actuals', rows: parsedRows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Nie udało się zaimportować obrotów')
      const result: ImportResult = { imported: data.imported ?? 0, errors: data.errors ?? [] }
      setImportResult(result)
      if (result.imported > 0) {
        setParsedRows([])
        setFileName('')
        if (fileRef.current) fileRef.current.value = ''
        router.refresh()
      }
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : 'Błąd połączenia z serwerem')
    } finally {
      setImporting(false)
    }
  }

  const clearFile = () => {
    setParsedRows([])
    setFileName('')
    setImportResult(null)
    setParseError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className={`${styles.theme} ${styles.stack}`}>
      <p className={styles.description}>
        Rzeczywiste obroty brutto po korektach. Import zastępuje kwotę dla miesiąca, salonu i kanału; nie dodaje jej do poprzedniego wpisu.
      </p>

      <div className={styles.importGrid}>
        {/* Export */}
        <div className={styles.panel}>
          <h3 className={styles.eyebrow}>Eksport CSV</h3>
          <div className={styles.toolbar}>
            <label className={styles.field}>
              <span>Rok</span>
              <Input
                type="number"
                value={exportYear}
                onChange={(e) => setExportYear(e.target.value)}
                placeholder="Wszystkie"
                className={styles.input}
              />
            </label>
            <label className={styles.field}>
              <span>Lokal</span>
              <select
                value={exportCostCenter}
                onChange={(e) => setExportCostCenter(e.target.value)}
                className={styles.input}
              >
                <option value="">Wszystkie</option>
                <option value="JAG">JAG</option>
                <option value="PUL">PUL</option>
              </select>
            </label>
          </div>
          <Button
            onClick={handleExport}
            disabled={!isAdmin}
            className={`${styles.button} ${styles.primary}`}
          >
            <svg className={styles.icon} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Eksportuj CSV
          </Button>
          <p className={styles.help}>
            Format: rok, miesiac, centrum_kosztow, kanal, kwota, stan_na_dzien (opcjonalnie, RRRR-MM-DD).
            Brak daty w imporcie oznacza nieokreśloną aktualność — również po zastąpieniu starszego wpisu.
          </p>
        </div>

        {/* Import */}
        <div className={styles.panel}>
          <h3 className={styles.eyebrow}>
            Import CSV
            {!canEditType && (
              <span className={styles.muted}> (brak uprawnień)</span>
            )}
          </h3>

          {canEditType ? (
            <>
              <div className={styles.toolbar}>
                <label className={styles.upload}>
                  <svg className={styles.icon} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {fileName || 'Wybierz plik CSV'}
                  <input ref={fileRef} type="file" accept=".csv" className="sr-only" onChange={handleFile} />
                </label>
                {fileName && (
                  <Button aria-label="Usuń wybrany plik" onClick={clearFile} className={styles.textButton}>×</Button>
                )}
              </div>

              {parseError && (
                <div role="alert" className={styles.error}>
                  {parseError}
                </div>
              )}

              {parsedRows.length > 0 && (
                <div className={styles.compactStack}>
                  <p className={styles.help}>
                    Podgląd ({parsedRows.length} wierszy):
                  </p>
                  <div className={styles.tableShell}>
                    <table className={`${styles.table} ${styles.previewTable}`}>
                      <thead>
                        <tr>
                          {CSV_FIELDS.map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 5).map((row, i) => (
                          <tr key={i}>
                            {CSV_FIELDS.map((h) => (
                              <td key={h}>{row[h]}</td>
                            ))}
                          </tr>
                        ))}
                        {parsedRows.length > 5 && (
                          <tr>
                            <td colSpan={CSV_FIELDS.length}>
                              ... i {parsedRows.length - 5} więcej
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    onClick={handleImport}
                    disabled={importing}
                    aria-busy={importing}
                    className={`${styles.button} ${styles.primary}`}
                  >
                    {!importing && (
                      <svg className={styles.icon} aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {importing ? 'Importowanie…' : `Importuj ${parsedRows.length} wierszy`}
                  </Button>
                </div>
              )}

              {importResult && (
                <div role="status" className={importResult.errors.length === 0 ? styles.status : styles.warning}>
                  <p>
                    Zaimportowano: <strong>{importResult.imported}</strong> wierszy
                    {importResult.errors.length > 0 && ` / Błędy: ${importResult.errors.length}`}
                  </p>
                  {importResult.errors.length > 0 && (
                    <ul className={styles.resultList}>
                      {importResult.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>Wiersz {e.row}: {e.message}</li>
                      ))}
                      {importResult.errors.length > 5 && (
                        <li>... i {importResult.errors.length - 5} więcej błędów</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className={styles.description}>
              Import rzeczywistych obrotów wymaga roli{' '}
              ADMIN.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
