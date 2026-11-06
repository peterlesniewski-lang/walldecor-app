// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { fetchSalesSummary } from '@/lib/finance/subiekt-bridge-client'

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

describe('bridge redirect isolation', () => {
  it('rejects redirects without sending Access credentials to the destination', async () => {
    let destinationRequests = 0
    const destination = createServer((_request, response) => {
      destinationRequests++
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ from: '2026-10-01', to: '2026-10-31', group_by: 'month_warehouse_kind', rows: [] }))
    })
    const destinationUrl = await listen(destination)
    const origin = createServer((_request, response) => {
      response.writeHead(302, { Location: destinationUrl })
      response.end()
    })
    try {
      const url = await listen(origin)
      await expect(fetchSalesSummary({
        url, token: 'synthetic-bridge-token',
        access: { clientId: 'synthetic-id', clientSecret: 'synthetic-secret' },
      }, { from: '2026-10-01', to: '2026-10-31' })).rejects.toMatchObject({ kind: 'unavailable' })
      expect(destinationRequests).toBe(0)
    } finally {
      await Promise.all([close(origin), close(destination)])
    }
  })
})
