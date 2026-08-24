import { describe, expect, it } from 'vitest'
import {
  INSTALLATION_MULTIPART_MAX_OVERHEAD_BYTES,
  parseInstallationMultipart,
} from '@/lib/installation-media/multipart'
import { INSTALLATION_MAX_FILE_BYTES } from '@/lib/installation-media/service'

const boundary = '----walldecor-streaming-boundary'

function bodyParts(fileBytes: Uint8Array, fields: Record<string, string> = { questionKey: 'zdjecie' }) {
  const encoder = new TextEncoder()
  const before = Object.entries(fields).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  ).join('') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sciana.png"\r\nContent-Type: image/png\r\n\r\n`
  return [encoder.encode(before), fileBytes, encoder.encode(`\r\n--${boundary}--\r\n`)]
}

function trackedRequest(parts: Uint8Array[], chunkSize = 16 * 1024, contentLength?: number) {
  let partIndex = 0
  let partOffset = 0
  let consumed = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      while (partIndex < parts.length && partOffset >= parts[partIndex].byteLength) { partIndex += 1; partOffset = 0 }
      if (partIndex >= parts.length) { controller.close(); return }
      const part = parts[partIndex]
      const chunk = part.slice(partOffset, partOffset + chunkSize)
      partOffset += chunk.byteLength
      consumed += chunk.byteLength
      controller.enqueue(chunk)
    },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  if (contentLength !== undefined) headers['Content-Length'] = String(contentLength)
  const request = new Request('http://test/upload', { method: 'POST', headers, body, duplex: 'half' } as RequestInit & { duplex: 'half' })
  return { request, consumed: () => consumed, cancelled: () => cancelled }
}

describe('bounded installation multipart parser', () => {
  it('returns one bounded file and only explicitly allowed scalar fields', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const tracked = trackedRequest(bodyParts(bytes, { questionKey: 'zdjecie' }))

    await expect(parseInstallationMultipart(tracked.request, { allowedFields: ['questionKey'] })).resolves.toEqual({
      fields: { questionKey: 'zdjecie' },
      file: { filename: 'sciana.png', contentType: 'image/png', bytes },
    })
  })

  it('rejects an oversized Content-Length before pulling any request bytes', async () => {
    const tracked = trackedRequest(bodyParts(new Uint8Array([1])), 1024, INSTALLATION_MAX_FILE_BYTES + INSTALLATION_MULTIPART_MAX_OVERHEAD_BYTES + 1)
    const consumedBeforeParsing = tracked.consumed()

    await expect(parseInstallationMultipart(tracked.request, { allowedFields: ['questionKey'] }))
      .rejects.toMatchObject({ status: 413 })
    expect(tracked.consumed()).toBe(consumedBeforeParsing)
    expect(tracked.cancelled()).toBe(true)
  })

  it('cancels a chunked oversized upload after the file limit plus one small input chunk', async () => {
    const tracked = trackedRequest(bodyParts(new Uint8Array(INSTALLATION_MAX_FILE_BYTES + 1024 * 1024)), 16 * 1024)

    await expect(parseInstallationMultipart(tracked.request, { allowedFields: ['questionKey'] }))
      .rejects.toMatchObject({ status: 413 })
    expect(tracked.consumed()).toBeLessThanOrEqual(INSTALLATION_MAX_FILE_BYTES + 32 * 1024)
    expect(tracked.cancelled()).toBe(true)
  })
})
