import Busboy from 'busboy'
import { once } from 'node:events'
import { INSTALLATION_MAX_FILE_BYTES } from './limits'

export const INSTALLATION_MULTIPART_MAX_OVERHEAD_BYTES = 64 * 1024
const MAX_FIELDS = 6
const MAX_PARTS = MAX_FIELDS + 1
const MAX_FIELD_BYTES = 4 * 1024

export class InstallationMultipartError extends Error {
  constructor(message: string, public readonly status: 400 | 413 = 400) {
    super(message)
    this.name = 'InstallationMultipartError'
  }
}

type MultipartResult = {
  fields: Record<string, string>
  file: { filename: string; contentType: string; bytes: Uint8Array }
}

function multipartError(error: unknown) {
  return error instanceof InstallationMultipartError
    ? error
    : new InstallationMultipartError('Nie udało się odczytać przesłanego formularza.')
}

/** Parses exactly one bounded file from a Web Request without ever buffering
 * the complete multipart body. The upstream reader is cancelled on every
 * parser or limit failure, including a chunked transfer without Content-Length. */
export async function parseInstallationMultipart(
  request: Request,
  options: { allowedFields: readonly string[] },
): Promise<MultipartResult> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new InstallationMultipartError('Żądanie musi zawierać formularz multipart.')
  }
  const maximumBodyBytes = INSTALLATION_MAX_FILE_BYTES + INSTALLATION_MULTIPART_MAX_OVERHEAD_BYTES
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      await request.body?.cancel().catch(() => undefined)
      throw new InstallationMultipartError('Nagłówek Content-Length jest niepoprawny.')
    }
    if (Number(contentLength) > maximumBodyBytes) {
      await request.body?.cancel().catch(() => undefined)
      throw new InstallationMultipartError('Plik przekracza limit 10 MB.', 413)
    }
  }
  if (!request.body) throw new InstallationMultipartError('Brakuje danych formularza.')

  const allowedFields = new Set(options.allowedFields)
  const fields: Record<string, string> = {}
  let fileResult: MultipartResult['file'] | null = null
  let failure: InstallationMultipartError | null = null
  let parser: ReturnType<typeof Busboy>
  try {
    parser = Busboy({
      headers: { 'content-type': contentType },
      limits: {
        fileSize: INSTALLATION_MAX_FILE_BYTES,
        files: 1,
        fields: MAX_FIELDS,
        parts: MAX_PARTS,
        fieldNameSize: 120,
        fieldSize: MAX_FIELD_BYTES,
      },
    })
  } catch {
    throw new InstallationMultipartError('Nagłówek formularza multipart jest niepoprawny.')
  }

  const reader = request.body.getReader()
  const abort = (error: InstallationMultipartError) => {
    if (failure) return
    failure = error
    void reader.cancel(error).catch(() => undefined)
    parser.destroy(error)
  }

  const completed = new Promise<MultipartResult>((resolve, reject) => {
    parser.on('file', (fieldName, file, info) => {
      const chunks: Uint8Array[] = []
      let byteLength = 0
      if (fieldName !== 'file' || fileResult) {
        file.resume()
        abort(new InstallationMultipartError('Formularz może zawierać dokładnie jeden plik.'))
        return
      }
      file.on('data', (chunk: Buffer) => {
        byteLength += chunk.byteLength
        chunks.push(new Uint8Array(chunk))
      })
      file.once('limit', () => abort(new InstallationMultipartError('Plik przekracza limit 10 MB.', 413)))
      file.once('error', () => undefined)
      file.once('end', () => {
        if (failure) return
        const bytes = new Uint8Array(byteLength)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        fileResult = { filename: info.filename, contentType: info.mimeType, bytes }
      })
    })
    parser.on('field', (name, value, info) => {
      if (!allowedFields.has(name) || Object.hasOwn(fields, name) || info.nameTruncated || info.valueTruncated) {
        abort(new InstallationMultipartError('Pola formularza są niepoprawne.'))
        return
      }
      fields[name] = value
    })
    parser.once('filesLimit', () => abort(new InstallationMultipartError('Formularz może zawierać dokładnie jeden plik.')))
    parser.once('fieldsLimit', () => abort(new InstallationMultipartError('Formularz zawiera zbyt wiele pól.')))
    parser.once('partsLimit', () => abort(new InstallationMultipartError('Formularz zawiera zbyt wiele części.')))
    parser.once('error', (error) => reject(failure ?? multipartError(error)))
    parser.once('finish', () => {
      if (failure) { reject(failure); return }
      if (!fileResult) { reject(new InstallationMultipartError('Wybierz plik.')); return }
      resolve({ fields, file: fileResult })
    })
  })

  const pumping = (async () => {
    let totalBytes = 0
    while (!failure) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBodyBytes) {
        abort(new InstallationMultipartError('Plik przekracza limit 10 MB.', 413))
        break
      }
      if (!parser.write(Buffer.from(value))) await once(parser, 'drain')
    }
    if (!failure) parser.end()
  })()

  try {
    const [, result] = await Promise.all([pumping, completed])
    return result
  } catch (error) {
    if (!failure) {
      await reader.cancel().catch(() => undefined)
      if (!parser.destroyed) parser.destroy()
    }
    throw failure ?? multipartError(error)
  }
}
