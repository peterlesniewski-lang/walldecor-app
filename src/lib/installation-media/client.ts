import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export class InstallationMediaClientError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'InstallationMediaClientError'
  }
}

export type PrivateMediaUpload = {
  fileId: string
  jobId: string
  contentType: string
  bytes: Uint8Array
}

export type PrivateMediaFile = {
  fileId: string
  jobId: string
  contentType: string
  byteSize: number
  sha256: string
}

type PrivateMediaConfig = {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

function privateHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new InstallationMediaClientError(`Prywatny serwer plików zwrócił niepoprawne pole ${field}.`)
  return value
}

function requireByteSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InstallationMediaClientError('Prywatny serwer plików zwrócił niepoprawny rozmiar pliku.')
  return value
}

async function json(response: Response) {
  try {
    return await response.json() as unknown
  } catch {
    throw new InstallationMediaClientError('Prywatny serwer plików zwrócił niepoprawną odpowiedź.', response.status)
  }
}

function responseError(response: Response, fallback: string) {
  return new InstallationMediaClientError(fallback, response.status)
}

/**
 * Private API adapter. Its bearer token and signed URL never leave the app
 * server; routes stream the returned Response after checking their own access.
 */
export function createPrivateMediaClient(config: PrivateMediaConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  if (!/^https?:\/\//.test(baseUrl) || !config.token.trim()) throw new InstallationMediaClientError('Brakuje bezpiecznej konfiguracji prywatnego serwera plików.')
  const request = config.fetchImpl ?? fetch

  return {
    async upload(input: PrivateMediaUpload): Promise<PrivateMediaFile> {
      const response = await request(`${baseUrl}/private/v1/files`, {
        method: 'POST',
        headers: {
          ...privateHeaders(config.token),
          'X-Installation-Job-Id': input.jobId,
          'X-Installation-File-Id': input.fileId,
          'Content-Type': input.contentType,
        },
        body: input.bytes as unknown as BodyInit,
      })
      if (!response.ok) throw responseError(response, 'Prywatny serwer plików odrzucił przesyłanie.')
      const payload = await json(response) as Record<string, unknown>
      const result = {
        fileId: requireText(payload.file_id, 'file_id'),
        jobId: requireText(payload.job_id, 'job_id'),
        contentType: requireText(payload.content_type, 'content_type'),
        byteSize: requireByteSize(payload.byte_size),
        sha256: requireText(payload.sha256, 'sha256'),
      }
      if (result.fileId !== input.fileId || result.jobId !== input.jobId || result.contentType !== input.contentType || result.byteSize !== input.bytes.byteLength || !/^[a-f0-9]{64}$/i.test(result.sha256)) {
        throw new InstallationMediaClientError('Prywatny serwer plików zwrócił niespójne metadane przesłania.')
      }
      return result
    },

    async download(fileId: string): Promise<Response> {
      const signed = await request(`${baseUrl}/private/v1/files/${encodeURIComponent(fileId)}/signed-download`, {
        method: 'POST', headers: privateHeaders(config.token),
      })
      if (!signed.ok) throw responseError(signed, 'Nie można przygotować prywatnego pobrania.')
      const signature = await json(signed) as Record<string, unknown>
      const exp = signature.expires_at
      const sig = signature.signature
      if (!Number.isSafeInteger(exp) || typeof sig !== 'string' || !sig.trim()) throw new InstallationMediaClientError('Prywatny serwer plików zwrócił niepoprawne upoważnienie pobrania.')
      const url = new URL(`${baseUrl}/private/v1/files/${encodeURIComponent(fileId)}`)
      url.searchParams.set('exp', String(exp))
      url.searchParams.set('sig', sig)
      const response = await request(url, { headers: privateHeaders(config.token) })
      if (!response.ok) throw responseError(response, 'Nie można pobrać prywatnego pliku.')
      return response
    },

    async remove(fileId: string): Promise<void> {
      const response = await request(`${baseUrl}/private/v1/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE', headers: privateHeaders(config.token),
      })
      if (!response.ok && response.status !== 404) throw responseError(response, 'Nie można usunąć prywatnego pliku.')
    },
  }
}

export function privateMediaClientFromEnvironment() {
  if (process.env.INSTALLATION_MEDIA_TEST_ADAPTER === 'memory') {
    if (process.env.NODE_ENV === 'production') throw new InstallationMediaClientError('Testowy adapter plików nie może działać produkcyjnie.')
    return inMemoryPrivateMediaClient()
  }
  if (process.env.INSTALLATION_MEDIA_TEST_ADAPTER === 'filesystem') {
    if (process.env.NODE_ENV === 'production') throw new InstallationMediaClientError('Testowy adapter plików nie może działać produkcyjnie.')
    const root = process.env.INSTALLATION_MEDIA_TEST_ROOT
    const resolvedRoot = root ? path.resolve(root) : ''
    if (!root || !path.isAbsolute(root) || !resolvedRoot.startsWith('/tmp/walldecor-installations-e2e-media-')) throw new InstallationMediaClientError('Testowy katalog mediów musi być izolowany w /tmp.')
    return filesystemPrivateMediaClient(resolvedRoot)
  }
  return createPrivateMediaClient({
    baseUrl: process.env.INSTALLATION_MEDIA_API_URL ?? '',
    token: process.env.INSTALLATION_MEDIA_API_TOKEN ?? '',
  })
}

export type PrivateMediaClient = ReturnType<typeof createPrivateMediaClient>

const testFiles = new Map<string, { jobId: string; contentType: string; bytes: Uint8Array; sha256: string }>()

/** E2E-only injected adapter. It is opt-in and fails closed in production; the
 * deployed application always needs the separate authenticated media service. */
function inMemoryPrivateMediaClient(): PrivateMediaClient {
  return {
    async upload({ fileId, jobId, contentType, bytes }) {
      const copy = new Uint8Array(bytes)
      const sha256 = createHash('sha256').update(copy).digest('hex')
      testFiles.set(fileId, { jobId, contentType, bytes: copy, sha256 })
      return { fileId, jobId, contentType, byteSize: copy.byteLength, sha256 }
    },
    async download(fileId) {
      const file = testFiles.get(fileId)
      if (!file) throw new InstallationMediaClientError('Testowy prywatny plik nie istnieje.', 404)
      return new Response(file.bytes as unknown as BodyInit, { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
    },
    async remove(fileId) {
      testFiles.delete(fileId)
    },
  }
}

/** A test-only durable implementation of the private-media contract. Browser
 * E2E calls still travel through the app routes; this merely persists the
 * server-side fake between dev-server restarts and adapter instances. */
function filesystemPrivateMediaClient(root: string): PrivateMediaClient {
  const safePath = (fileId: string, extension: 'bin' | 'json') => {
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new InstallationMediaClientError('Testowy identyfikator pliku jest niepoprawny.')
    return path.join(root, `${fileId}.${extension}`)
  }
  return {
    async upload({ fileId, jobId, contentType, bytes }) {
      await mkdir(root, { recursive: true, mode: 0o700 })
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const filePath = safePath(fileId, 'bin')
      const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.uploading`
      await writeFile(temporaryPath, bytes)
      await rename(temporaryPath, filePath)
      await writeFile(safePath(fileId, 'json'), JSON.stringify({ jobId, contentType, sha256 }), { mode: 0o600 })
      return { fileId, jobId, contentType, byteSize: bytes.byteLength, sha256 }
    },
    async download(fileId) {
      try {
        const [bytes, rawMeta] = await Promise.all([readFile(safePath(fileId, 'bin')), readFile(safePath(fileId, 'json'), 'utf8')])
        const meta = JSON.parse(rawMeta) as { contentType?: unknown }
        if (typeof meta.contentType !== 'string') throw new Error('invalid')
        return new Response(bytes as unknown as BodyInit, { headers: { 'Content-Type': meta.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
      } catch {
        throw new InstallationMediaClientError('Testowy prywatny plik nie istnieje.', 404)
      }
    },
    async remove(fileId) {
      await Promise.all([rm(safePath(fileId, 'bin'), { force: true }), rm(safePath(fileId, 'json'), { force: true })])
    },
  }
}
