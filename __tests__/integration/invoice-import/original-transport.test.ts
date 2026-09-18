// @vitest-environment node
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createInvoiceImportClient } from '@/lib/invoice-import/client'

// One blank page, with a real cross-reference table; no invoice or customer data.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>',
]
let pdf = '%PDF-1.4\n'
const offsets = objects.map((object, index) => {
  const offset = Buffer.byteLength(pdf)
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  return offset
})
const xrefOffset = Buffer.byteLength(pdf)
pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
const bytes = Buffer.from(pdf)
const expected = { byteSize: bytes.length, mimeType: 'application/pdf' as const, sha256: createHash('sha256').update(bytes).digest('hex') }
const transports = ['identity', 'gzip-chunked', 'gzip-content-length'] as const
type Transport = typeof transports[number]

async function withOriginalServer(transport: Transport, decodedBytes: Buffer, check: (client: ReturnType<typeof createInvoiceImportClient>) => Promise<void>) {
  const encodedBytes = transport === 'identity' ? decodedBytes : gzipSync(decodedBytes)
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', expected.mimeType)
    if (transport !== 'identity') response.setHeader('Content-Encoding', 'gzip')
    if (transport !== 'gzip-chunked') response.setHeader('Content-Length', encodedBytes.length)
    response.write(encodedBytes.subarray(0, 10))
    response.end(encodedBytes.subarray(10))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a localhost TCP address')
    const origin = `http://127.0.0.1:${address.port}`
    let receivedHeaders = new Headers()
    const client = createInvoiceImportClient(async (input, init) => {
      const response = await fetch(new URL(String(input), origin), init)
      receivedHeaders = response.headers
      return response
    })
    await check(client)
    // Keep assertions outside fetch: original() deliberately normalizes fetch errors.
    if (transport === 'gzip-chunked') {
      expect(receivedHeaders.get('content-length')).toBeNull()
      expect(receivedHeaders.get('transfer-encoding')).toBe('chunked')
    } else {
      expect(receivedHeaders.get('content-length')).toBe(String(encodedBytes.length))
    }
    if (transport !== 'identity') {
      expect(receivedHeaders.get('content-encoding')).toBe('gzip')
      expect(encodedBytes.length).not.toBe(expected.byteSize)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
}

describe('invoice originals over real HTTP transport', () => {
  it.each(transports)('returns the verified synthetic PDF through %s', async (transport) => {
    await withOriginalServer(transport, bytes, async (client) => {
      const original = await client.original('synthetic-draft', expected)
      expect(original.type).toBe(expected.mimeType)
      expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes)
    })
  })

  const corrupted = Buffer.from(bytes)
  corrupted[20] ^= 1
  for (const [name, invalidBytes] of [
    ['corrupted', corrupted],
    ['truncated', bytes.subarray(0, bytes.length - 1)],
    ['excess', Buffer.concat([bytes, Buffer.from('x')])],
  ] as const) {
    it.each(transports)(`rejects ${name} decoded original bytes through %s`, async (transport) => {
      await withOriginalServer(transport, invalidBytes, async (client) => {
        await expect(client.original('synthetic-draft', expected)).rejects.toMatchObject({ code: 'INVALID_ORIGINAL' })
      })
    })
  }
})
