'use client'
import { useState, useRef } from 'react'
import Papa from 'papaparse'

interface CsvCostsPanelProps {
  userRole: string
}

type DataType = 'budget' | 'actuals'

interface CsvRow {
  rok: string
  miesiac: string
  centrum_kosztow: string
  kategoria: string
  podkategoria: string
  kwota: string
  [key: string]: string
}

interface ImportResult {
  imported: number
  errors: { row: number; message: string }[]
}

const CURRENT_YEAR = new Date().getFullYear()

export function CsvCostsPanel({ userRole }: CsvCostsPanelProps) {
  const isAdmin = userRole === 'ADMIN'
  const canImport = isAdmin || userRole === 'MANAGER'

  const [dataType, setDataType] = useState<DataType>('actuals')
  const [exportYear, setExportYear] = useState<string>(String(CURRENT_YEAR))
  const [exportCostCenter, setExportCostCenter] = useState<string>('')
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const canEditType = dataType === 'budget' ? isAdmin : canImport

  const handleExport = () => {
    const params = new URLSearchParams({ type: dataType })
    if (exportYear) params.set('year', exportYear)
    if (exportCostCenter) params.set('costCenterId', exportCostCenter)
    window.location.href = `/api/export/costs?${params}`
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
        const required = ['rok', 'miesiac', 'centrum_kosztow', 'kategoria', 'podkategoria', 'kwota']
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

    try {
      const res = await fetch('/api/import/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: dataType, rows: parsedRows }),
      })
      const data: ImportResult = await res.json()
      setImportResult(data)
      if (data.imported > 0) {
        setParsedRows([])
        setFileName('')
        if (fileRef.current) fileRef.current.value = ''
      }
    } catch {
      setParseError('Błąd połączenia z serwerem')
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
    <div className="space-y-6">
      {/* Type toggle */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        {(['actuals', 'budget'] as DataType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setDataType(t); clearFile(); setImportResult(null) }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              dataType === t
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'budget' ? 'Plan budżetowy' : 'Wykonanie kosztów'}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Export */}
        <div className="rounded-xl border border-[var(--wd-border)] p-5 space-y-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-gray-400">Eksport CSV</h3>
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Rok</label>
              <input
                type="number"
                value={exportYear}
                onChange={(e) => setExportYear(e.target.value)}
                placeholder="Wszystkie"
                className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[var(--wd-sand)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Lokal</label>
              <select
                value={exportCostCenter}
                onChange={(e) => setExportCostCenter(e.target.value)}
                className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[var(--wd-sand)] bg-white"
              >
                <option value="">Wszystkie</option>
                <option value="JAG">JAG</option>
                <option value="PUL">PUL</option>
                <option value="GLOBAL">GLOBAL</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--wd-dark)] text-white hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Eksportuj CSV
          </button>
          <p className="text-xs text-gray-400">
            Format: rok, miesiac, centrum_kosztow, kategoria, podkategoria, kwota
          </p>
        </div>

        {/* Import */}
        <div className="rounded-xl border border-[var(--wd-border)] p-5 space-y-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-gray-400">
            Import CSV
            {!canEditType && (
              <span className="ml-2 text-xs font-normal text-amber-500 normal-case">(brak uprawnień)</span>
            )}
          </h3>

          {canEditType ? (
            <>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:border-[var(--wd-sand)] hover:text-gray-700 cursor-pointer transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {fileName || 'Wybierz plik CSV'}
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
                </label>
                {fileName && (
                  <button onClick={clearFile} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                )}
              </div>

              {parseError && (
                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                  {parseError}
                </div>
              )}

              {parsedRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Podgląd ({parsedRows.length} wierszy):
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          {['rok','miesiac','centrum_kosztow','kategoria','podkategoria','kwota'].map((h) => (
                            <th key={h} className="px-2 py-1 text-left font-medium text-gray-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-t border-gray-50">
                            {['rok','miesiac','centrum_kosztow','kategoria','podkategoria','kwota'].map((h) => (
                              <td key={h} className="px-2 py-1 text-gray-600 truncate max-w-[80px]">{row[h]}</td>
                            ))}
                          </tr>
                        ))}
                        {parsedRows.length > 5 && (
                          <tr className="border-t border-gray-50">
                            <td colSpan={6} className="px-2 py-1 text-gray-400 italic">
                              ... i {parsedRows.length - 5} więcej
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 transition-colors"
                  >
                    {importing ? (
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    Importuj {parsedRows.length} wierszy
                  </button>
                </div>
              )}

              {importResult && (
                <div className={`px-3 py-2 rounded-lg text-sm space-y-1 ${
                  importResult.errors.length === 0
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-amber-50 border border-amber-200'
                }`}>
                  <p className={importResult.errors.length === 0 ? 'text-green-700' : 'text-amber-700'}>
                    Zaimportowano: <strong>{importResult.imported}</strong> wierszy
                    {importResult.errors.length > 0 && ` / Błędy: ${importResult.errors.length}`}
                  </p>
                  {importResult.errors.length > 0 && (
                    <ul className="text-xs text-amber-600 space-y-0.5">
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
            <p className="text-sm text-gray-400">
              Import {dataType === 'budget' ? 'planu budżetowego' : 'wykonania'} wymaga roli{' '}
              {dataType === 'budget' ? 'ADMIN' : 'ADMIN lub MANAGER'}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
