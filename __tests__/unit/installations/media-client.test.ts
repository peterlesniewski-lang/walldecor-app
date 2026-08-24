import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPrivateMediaClient, InstallationMediaClientError, privateMediaClientFromEnvironment } from '@/lib/installation-media/client'

const privateUrl = 'http://private-media.example.test'
const privateToken = 'test-private-media-token'

describe('private media client', () => {
  it('aborts every private-media request at the configured timeout without exposing the bearer token', async () => {
    const hanging = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true })
    }))
    const timedClient = createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl: hanging, timeoutMs: 15 })
    const uploadError = await timedClient.upload({ fileId: 'file-1', jobId: 'order-1', contentType: 'image/png', bytes: new Uint8Array([1]) }).catch((error) => error)
    const signedError = await timedClient.download('file-signed-timeout').catch((error) => error)
    const deleteError = await timedClient.remove('file-delete-timeout').catch((error) => error)

    const signedThenHangingDownload = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/signed-download')) return Promise.resolve(Response.json({ expires_at: 1_799_999_999, signature: 'safe-signature' }))
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true }))
    })
    const downloadError = await createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl: signedThenHangingDownload, timeoutMs: 15 })
      .download('file-download-timeout').catch((error) => error)

    for (const error of [uploadError, signedError, downloadError, deleteError]) {
      expect(error).toBeInstanceOf(InstallationMediaClientError)
      expect(String(error.message)).toContain('przekroczył limit czasu')
      expect(String(error.message)).not.toContain(privateToken)
    }
    expect(hanging).toHaveBeenCalledTimes(3)
    expect(signedThenHangingDownload).toHaveBeenCalledTimes(2)
  })

  it('keeps the timeout active until the private download body finishes', async () => {
    let bodyCancelled = false
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/signed-download')) {
        return Response.json({ expires_at: 1_799_999_999, signature: 'safe-signature' })
      }
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
        },
        cancel() {
          bodyCancelled = true
        },
      }))
    })

    const error = await createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl, timeoutMs: 15 })
      .download('slow-body').catch((caught) => caught)

    expect(error).toBeInstanceOf(InstallationMediaClientError)
    expect(error.message).toContain('przekroczył limit czasu')
    expect(error.message).not.toContain(privateToken)
    expect(bodyCancelled).toBe(true)
  })

  it('does not confirm a remote delete until its response body has finished', async () => {
    let bodyCancelled = false
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        bodyCancelled = true
      },
    }), { status: 200 }))

    const error = await createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl, timeoutMs: 15 })
      .remove('slow-delete-body').catch((caught) => caught)

    expect(error).toBeInstanceOf(InstallationMediaClientError)
    expect(error.message).toContain('przekroczył limit czasu')
    expect(error.message).not.toContain(privateToken)
    expect(bodyCancelled).toBe(true)
  })

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

    const response = await createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl }).download('file-1', {
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects a private download that does not match the database integrity snapshot', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/signed-download')) return Response.json({ expires_at: 1_799_999_999, signature: 'safe-signature' })
      return new Response(new Uint8Array([1, 2, 3]))
    })
    const client = createPrivateMediaClient({ baseUrl: privateUrl, token: privateToken, fetchImpl })
    await expect(client.download('file-1', { byteSize: 3, sha256: 'a'.repeat(64) }))
      .rejects.toThrow('niespójnej sumie kontrolnej')
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

  it('rejects a filesystem test root that escapes its isolated /tmp prefix', () => {
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'filesystem')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ROOT', '/tmp/walldecor-installations-e2e-media-escape/../../outside')
    vi.stubEnv('NODE_ENV', 'test')
    expect(() => privateMediaClientFromEnvironment()).toThrow(InstallationMediaClientError)
    vi.unstubAllEnvs()
  })

  it('persists media only inside the same verified private directory as the Calendar E2E database', async () => {
    const directory = mkdtempSync('/tmp/walldecor-installations-e2e-')
    const databaseUrl = `file:${path.join(directory, 'calendar.db')}`
    const mediaRoot = path.join(directory, 'media')
    const fileId = 'de3d9ad1-2ffc-44dd-b77c-a7ec338aee50'
    const bytes = new Uint8Array([4, 5, 6])
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'filesystem')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ROOT', mediaRoot)
    vi.stubEnv('WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED', 'true')
    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('E2E_DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'test')

    try {
      const client = privateMediaClientFromEnvironment()
      await client.upload({ fileId, jobId: 'calendar-order', contentType: 'image/png', bytes })
      expect(new Uint8Array(await (await client.download(fileId)).arrayBuffer())).toEqual(bytes)
      expect(existsSync(path.join(mediaRoot, `${fileId}.bin`))).toBe(true)
      await client.remove(fileId)
      expect(existsSync(path.join(mediaRoot, `${fileId}.bin`))).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked Calendar E2E media root that points outside its private directory', () => {
    const directory = mkdtempSync('/tmp/walldecor-installations-e2e-')
    const outside = mkdtempSync('/tmp/walldecor-installations-media-outside-')
    const databaseUrl = `file:${path.join(directory, 'calendar.db')}`
    symlinkSync(outside, path.join(directory, 'media'), 'dir')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'filesystem')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ROOT', path.join(directory, 'media'))
    vi.stubEnv('WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED', 'true')
    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('E2E_DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'test')

    try {
      expect(() => privateMediaClientFromEnvironment()).toThrow(InstallationMediaClientError)
    } finally {
      vi.unstubAllEnvs()
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects the Calendar E2E filesystem adapter in production', () => {
    const directory = mkdtempSync('/tmp/walldecor-installations-e2e-')
    const databaseUrl = `file:${path.join(directory, 'calendar.db')}`
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'filesystem')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ROOT', path.join(directory, 'media'))
    vi.stubEnv('WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED', 'true')
    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('E2E_DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'production')

    try {
      expect(() => privateMediaClientFromEnvironment()).toThrow('nie może działać produkcyjnie')
    } finally {
      vi.unstubAllEnvs()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an unbound or non-private Calendar E2E media directory', () => {
    const directory = mkdtempSync('/tmp/walldecor-installations-e2e-')
    const databaseUrl = `file:${path.join(directory, 'calendar.db')}`
    const mediaRoot = path.join(directory, 'media')
    mkdirSync(mediaRoot, { mode: 0o700 })
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'filesystem')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ROOT', mediaRoot)
    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('E2E_DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'test')

    try {
      expect(() => privateMediaClientFromEnvironment()).toThrow(InstallationMediaClientError)
      vi.stubEnv('WALLDECOR_E2E_PRIVATE_DIRECTORY_OWNED', 'true')
      chmodSync(mediaRoot, 0o755)
      expect(() => privateMediaClientFromEnvironment()).toThrow('nie jest prywatnym katalogiem E2E')
    } finally {
      vi.unstubAllEnvs()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('persists the explicitly injected E2E adapter across a fresh Node process', async () => {
    const root = mkdtempSync('/tmp/walldecor-installations-e2e-media-client-')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ADAPTER', 'filesystem')
    vi.stubEnv('INSTALLATION_MEDIA_TEST_ROOT', root)
    vi.stubEnv('NODE_ENV', 'test')
    const bytes = new Uint8Array([9, 8, 7, 6])
    const first = privateMediaClientFromEnvironment()
    await first.upload({ fileId: '3a5cc5c4-83df-4744-87a8-7536703a4c25', jobId: 'order-e2e', contentType: 'image/png', bytes })
    const restartedProcess = spawnSync(process.execPath, [
      '--import', 'tsx', '-e',
      "import mediaModule from './src/lib/installation-media/client.ts'; const response = await mediaModule.privateMediaClientFromEnvironment().download(process.argv[1]); process.stdout.write(Buffer.from(await response.arrayBuffer()).toString('base64'))",
      '3a5cc5c4-83df-4744-87a8-7536703a4c25',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test', INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem', INSTALLATION_MEDIA_TEST_ROOT: root },
      encoding: 'utf8',
    })
    expect(restartedProcess.status, restartedProcess.stderr).toBe(0)
    expect(Buffer.from(restartedProcess.stdout, 'base64')).toEqual(Buffer.from(bytes))
    await first.remove('3a5cc5c4-83df-4744-87a8-7536703a4c25')
    rmSync(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })
})
