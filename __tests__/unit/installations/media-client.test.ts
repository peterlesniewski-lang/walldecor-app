import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createPrivateMediaClient, InstallationMediaClientError, privateMediaClientFromEnvironment } from '@/lib/installation-media/client'

const privateUrl = 'http://private-media.example.test'
const privateToken = 'test-private-media-token'

describe('private media client', () => {
  it('uploads the exact bytes only through the private authenticated endpoint', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`${privateUrl}/private/v1/files`)
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${privateToken}`,
        'X-Installation-Job-Id': 'order-1',
        'X-Installation-File-Id': 'file-1',
        'Content-Type': 'image/png',
      })
      expect(init?.body).toBe(bytes)
      return Response.json({ file_id: 'file-1', job_id: 'order-1', content_type: 'image/png', byte_size: bytes.byteLength, sha256 })
    })

    const client = createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl })
    await expect(client.upload({ fileId: 'file-1', jobId: 'order-1', contentType: 'image/png', bytes })).resolves.toEqual({
      fileId: 'file-1', jobId: 'order-1', contentType: 'image/png', byteSize: bytes.byteLength, sha256,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('proxies a signed private download without returning a media URL to the browser', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45])
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${privateToken}` })
      // Exact private-media server contract: snake_case expires_at, never exp.
      if (url.pathname.endsWith('/signed-download')) return Response.json({ expires_at: 1_799_999_999, signature: 'safe-signature' })
      expect(url.pathname).toBe('/private/v1/files/file-1')
      expect(url.searchParams.get('exp')).toBe('1799999999')
      expect(url.searchParams.get('sig')).toBe('safe-signature')
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } })
    })

    const response = await createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl }).download('file-1')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not accept a malformed response from the private media service', async () => {
    const client = createPrivateMediaClient({
      baseUrl: privateUrl,
      token: privateToken,
      fetchImpl: vi.fn(async () => Response.json({ file_id: 'other-file' })),
    })
    await expect(client.upload({ fileId: 'file-1', jobId: 'order-1', contentType: 'image/png', bytes: new Uint8Array([1]) }))
      .rejects.toBeInstanceOf(InstallationMediaClientError)
  })

  it('allows an explicitly injected memory adapter only in non-production E2E mode', async () => {
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'memory')
    vi.stubEnv('NODE_ENV', 'test')
    const client = privateMediaClientFromEnvironment()
    await client.upload({ fileId: 'e2e-file', jobId: 'e2e-order', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    expect(new Uint8Array(await (await client.download('e2e-file')).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    await client.remove('e2e-file')
    await expect(client.download('e2e-file')).rejects.toBeInstanceOf(InstallationMediaClientError)
    vi.unstubAllEnvs()
  })
})
