import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { INSTALLATION_MAX_FILE_BYTES } from './limits'

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
  timeoutMs?: number
}

type ExpectedPrivateMediaFile = {
  byteSize?: number | null
  sha256?: string | null
}

const DEFAULT_PRIVATE_MEDIA_TIMEOUT_MS = 15_000
const MAX_PRIVATE_MEDIA_TIMEOUT_MS = 120_000

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

async function boundedResponse(response: Response, signal: AbortSignal, expected?: ExpectedPrivateMediaFile) {
  const contentLength = response.headers.get('content-length')
  if (contentLength && (/^\d+$/.test(contentLength) === false || Number(contentLength) > INSTALLATION_MAX_FILE_BYTES)) {
    await response.body?.cancel().catch(() => undefined)
    throw new InstallationMediaClientError('Prywatny serwer plików zwrócił zbyt duży plik.')
  }
  if (!response.body) throw new InstallationMediaClientError('Prywatny serwer plików zwrócił pustą odpowiedź.')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteSize = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteSize += chunk.value.byteLength
      if (byteSize > INSTALLATION_MAX_FILE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new InstallationMediaClientError('Prywatny serwer plików zwrócił zbyt duży plik.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteSize)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (expected?.byteSize != null && expected.byteSize !== byteSize) {
    throw new InstallationMediaClientError('Prywatny serwer plików zwrócił plik o niespójnym rozmiarze.')
  }
  if (expected?.sha256 && createHash('sha256').update(bytes).digest('hex') !== expected.sha256.toLowerCase()) {
    throw new InstallationMediaClientError('Prywatny serwer plików zwrócił plik o niespójnej sumie kontrolnej.')
  }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/**
 * Private API adapter. Its bearer token and signed URL never leave the app
 * server; routes stream the returned Response after checking their own access.
 */
export function createPrivateMediaClient(config: PrivateMediaConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  if (!/^https?:\/\//.test(baseUrl) || !config.token.trim()) throw new InstallationMediaClientError('Brakuje bezpiecznej konfiguracji prywatnego serwera plików.')
  const request = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_PRIVATE_MEDIA_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PRIVATE_MEDIA_TIMEOUT_MS) {
    throw new InstallationMediaClientError('Limit czasu prywatnego serwera plików jest niepoprawny.')
  }

  async function timedRequest<T>(label: string, operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const result = await operation(controller.signal)
      if (controller.signal.aborted) throw new InstallationMediaClientError(`Prywatny serwer plików przekroczył limit czasu: ${label}.`)
      return result
    } catch (error) {
      if (controller.signal.aborted) throw new InstallationMediaClientError(`Prywatny serwer plików przekroczył limit czasu: ${label}.`)
      if (error instanceof InstallationMediaClientError) throw error
      throw new InstallationMediaClientError(`Nie udało się połączyć z prywatnym serwerem plików: ${label}.`)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async upload(input: PrivateMediaUpload): Promise<PrivateMediaFile> {
      return timedRequest('upload', async (signal) => {
        const response = await request(`${baseUrl}/private/v1/files`, {
          method: 'POST',
          headers: {
            ...privateHeaders(config.token),
            'X-Installation-Job-Id': input.jobId,
            'X-Installation-File-Id': input.fileId,
            'Content-Type': input.contentType,
          },
          body: input.bytes as unknown as BodyInit,
          signal,
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
      })
    },

    async download(fileId: string, expected?: ExpectedPrivateMediaFile): Promise<Response> {
      const signature = await timedRequest('signed-download', async (signal) => {
        const signed = await request(`${baseUrl}/private/v1/files/${encodeURIComponent(fileId)}/signed-download`, {
          method: 'POST', headers: privateHeaders(config.token), signal,
        })
        if (!signed.ok) throw responseError(signed, 'Nie można przygotować prywatnego pobrania.')
        return json(signed) as Promise<Record<string, unknown>>
      })
      const exp = signature.expires_at
      const sig = signature.signature
      if (!Number.isSafeInteger(exp) || typeof sig !== 'string' || !sig.trim()) throw new InstallationMediaClientError('Prywatny serwer plików zwrócił niepoprawne upoważnienie pobrania.')
      const url = new URL(`${baseUrl}/private/v1/files/${encodeURIComponent(fileId)}`)
      url.searchParams.set('exp', String(exp))
      url.searchParams.set('sig', sig)
      return timedRequest('download', async (signal) => {
        const response = await request(url, { headers: privateHeaders(config.token), signal })
        if (!response.ok) throw responseError(response, 'Nie można pobrać prywatnego pliku.')
        return boundedResponse(response, signal, expected)
      })
    },

    async remove(fileId: string): Promise<void> {
      await timedRequest('delete', async (signal) => {
        const response = await request(`${baseUrl}/private/v1/files/${encodeURIComponent(fileId)}`, {
          method: 'DELETE', headers: privateHeaders(config.token), signal,
        })
        if (!response.ok && response.status !== 404) throw responseError(response, 'Nie można usunąć prywatnego pliku.')
      })
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
    timeoutMs: privateMediaTimeoutFromEnvironment(process.env.INSTALLATION_MEDIA_TIMEOUT_MS),
  })
}

function privateMediaTimeoutFromEnvironment(value: string | undefined) {
  if (value === undefined || value.trim() === '') return DEFAULT_PRIVATE_MEDIA_TIMEOUT_MS
  if (!/^[1-9]\d*$/.test(value)) throw new InstallationMediaClientError('INSTALLATION_MEDIA_TIMEOUT_MS musi być dodatnią liczbą całkowitą.')
  return Number(value)
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
