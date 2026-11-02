import { createServer, type Server } from 'node:http'

/** Fixed port shared by playwright.config.ts (server env) and the spec that starts the mock. */
export const E2E_SUBIEKT_BRIDGE_PORT = 38787

/**
 * Minimal stand-in for walldecor-bridge `GET /api/sales/summary` used only by
 * the Playwright spec and the validation script. Never part of the application.
 */
export interface MockSalesRow {
  year: number
  month: number
  warehouse_symbol: string
  warehouse_name?: string
  kind: 'TOWAR' | 'USLUGA'
  documents: number
  net_total: number
  gross_total: number
}

export interface SubiektBridgeMock {
  server: Server
  port: number
  url: string
  calls: Array<{ path: string; authorization: string | null }>
  setRows(rows: MockSalesRow[]): void
  close(): Promise<void>
}

export function startSubiektBridgeMock(options: { port?: number; token: string; rows: MockSalesRow[] }): Promise<SubiektBridgeMock> {
  let rows = options.rows
  const calls: SubiektBridgeMock['calls'] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    calls.push({ path: url.pathname + url.search, authorization: req.headers.authorization ?? null })
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (url.pathname === '/health') return json(200, { ok: true, version: 'mock', db: 'up' })
    if (req.headers.authorization !== `Bearer ${options.token}`) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Brak lub nieprawidłowy token.' } })
    if (url.pathname !== '/api/sales/summary') return json(404, { error: { code: 'NOT_FOUND', message: 'Nie ma takiego zasobu.' } })
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    if (url.searchParams.get('group_by') !== 'month_warehouse_kind') return json(400, { error: { code: 'INVALID_INPUT', message: 'Nieobsługiwane group_by.' } })
    const inRange = rows.filter((row) => { const key = `${row.year}-${String(row.month).padStart(2, '0')}`; return key >= from.slice(0, 7) && key <= to.slice(0, 7) })
    const total = inRange.reduce((acc, row) => ({ documents: acc.documents + row.documents, net_total: acc.net_total + row.net_total, gross_total: acc.gross_total + row.gross_total }), { documents: 0, net_total: 0, gross_total: 0 })
    return json(200, { from, to, group_by: 'month_warehouse_kind', doc_types: ['FS', 'KFS', 'PA', 'ZW'], date_basis: 'dok_DataWyst', rows: inRange, total, excluded: { fs_subtype_1_documents: 0, zw_documents_subtracted: 0 }, summary: `Mock: ${inRange.length} wierszy` })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : options.port ?? 0
      resolve({
        server, port, url: `http://127.0.0.1:${port}`, calls,
        setRows(next) { rows = next },
        close: () => new Promise<void>((done) => { server.closeAllConnections?.(); server.close(() => done()) }),
      })
    })
  })
}
