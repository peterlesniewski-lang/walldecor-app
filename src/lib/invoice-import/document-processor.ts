import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import {
  INVOICE_ATTACHMENT_MAX_BYTES,
  INVOICE_ATTACHMENT_MAX_PDF_PAGES,
  type InvoiceAttachmentMimeType,
} from './contracts'

const MAX_IMAGE_PIXELS = 40_000_000
const MAX_NORMALIZED_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_RENDERED_IMAGE_PIXELS = 4_000_000
const MAX_RENDERED_TOTAL_BYTES = 60 * 1024 * 1024
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024
const MAX_INSPECTION_TIMEOUT_MS = 15_000
const MAX_RENDER_TIMEOUT_MS = 60_000
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const READ_NOFOLLOW_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_ANIMATION_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT'])
const CRC32_TABLE = new Uint32Array(256)
for (let value = 0; value < CRC32_TABLE.length; value += 1) {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0)
  }
  CRC32_TABLE[value] = crc >>> 0
}

export interface InvoiceDocumentProcessorConfig {
  pdfInfoBinary: string
  pdfToPpmBinary: string
  workRoot: string
  signal?: AbortSignal
  /** May lower native-process limits, never raise them. */
  timeoutMs?: number
}

export interface InvoiceDocumentMetadata {
  mimeType: InvoiceAttachmentMimeType
  byteSize: number
  sha256: string
  pageCount: number | null
}

export type InvoiceDocumentProcessorErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_TYPE'
  | 'DOCUMENT_TOO_LARGE'
  | 'IMAGE_TOO_LARGE'
  | 'PDF_ENCRYPTED'
  | 'PDF_PAGE_LIMIT'
  | 'PROCESS_TIMEOUT'
  | 'ABORTED'
  | 'PROCESS_FAILURE'
  | 'OUTPUT_LIMIT'
  | 'UNSAFE_WORK_ROOT'
  | 'CLEANUP_FAILURE'

export class InvoiceDocumentProcessorError extends Error {
  readonly code: InvoiceDocumentProcessorErrorCode

  constructor(code: InvoiceDocumentProcessorErrorCode) {
    super(code)
    this.name = 'InvoiceDocumentProcessorError'
    this.code = code
  }
}

function genericProcessingError(error: unknown): InvoiceDocumentProcessorError {
  return error instanceof InvoiceDocumentProcessorError
    ? error
    : new InvoiceDocumentProcessorError('PROCESS_FAILURE')
}

function operationDeadline(config: InvoiceDocumentProcessorConfig, ceilingMs: number): number {
  return performance.now() + Math.min(config.timeoutMs ?? ceilingMs, ceilingMs)
}

function remainingMilliseconds(deadline: number, signal?: AbortSignal): number {
  if (signal?.aborted) throw new InvoiceDocumentProcessorError('ABORTED')
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw new InvoiceDocumentProcessorError('PROCESS_TIMEOUT')
  return remaining
}

function remainingSharpSeconds(deadline: number, signal?: AbortSignal): number {
  const remaining = remainingMilliseconds(deadline, signal)
  // Sharp accepts whole seconds only. One second is the smallest cancellable
  // operation; the absolute post-operation check below rejects a late result
  // without racing cleanup against native work that is still active.
  return Math.max(1, Math.floor(remaining / 1_000))
}

function isSharpTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message)
}

function validateConfig(config: InvoiceDocumentProcessorConfig): void {
  const paths = [config.pdfInfoBinary, config.pdfToPpmBinary, config.workRoot]
  if (
    process.platform === 'win32' ||
    !paths.every((entry) => typeof entry === 'string' && isAbsolute(entry)) ||
    resolve(config.workRoot) === parse(resolve(config.workRoot)).root ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > MAX_RENDER_TIMEOUT_MS))
  ) {
    throw new InvoiceDocumentProcessorError('INVALID_CONFIG')
  }
}

function isByteView(bytes: Uint8Array): boolean {
  return Buffer.isBuffer(bytes) || (ArrayBuffer.isView(bytes) && bytes.BYTES_PER_ELEMENT === 1)
}

type ImageMimeType = Exclude<InvoiceAttachmentMimeType, 'application/pdf'>

function isPdf(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === '%PDF'
}

function detectImageMimeType(bytes: Buffer): ImageMimeType | null {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function pngCrc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[index]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Bounded by the already-enforced 10 MiB document limit. */
function validateStaticPngStructure(bytes: Buffer): void {
  let offset = PNG_SIGNATURE.length
  let chunkCount = 0
  let sawHeader = false
  let sawImageData = false
  let sawEnd = false

  while (offset < bytes.length) {
    chunkCount += 1
    if (chunkCount > 100_000 || bytes.length - offset < 12) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    const dataLength = bytes.readUInt32BE(offset)
    if (dataLength > bytes.length - offset - 12) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + dataLength
    const nextOffset = dataEnd + 4
    const type = bytes.toString('ascii', typeStart, dataStart)
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    const expectedCrc = bytes.readUInt32BE(dataEnd)
    if (pngCrc32(bytes, typeStart, dataEnd) !== expectedCrc) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    if (!sawHeader) {
      if (type !== 'IHDR' || dataLength !== 13) {
        throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
      }
      sawHeader = true
    } else if (type === 'IHDR') {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    if (PNG_ANIMATION_CHUNKS.has(type)) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    if (type === 'IDAT') sawImageData = true
    if (type === 'IEND') {
      if (dataLength !== 0 || !sawImageData || nextOffset !== bytes.length) {
        throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
      }
      sawEnd = true
      offset = nextOffset
      break
    }
    offset = nextOffset
  }

  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
}

function validateJpegBoundary(bytes: Buffer): void {
  if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
}

/** Validates the RIFF envelope and rejects every WebP animation signal. */
function validateStaticWebpStructure(bytes: Buffer): void {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
  let offset = 12
  let chunkCount = 0
  let sawStillImage = false
  while (offset < bytes.length) {
    chunkCount += 1
    if (chunkCount > 100_000 || bytes.length - offset < 8) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    const type = bytes.toString('ascii', offset, offset + 4)
    const dataLength = bytes.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    if (dataLength > bytes.length - dataStart) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    const dataEnd = dataStart + dataLength
    const nextOffset = dataEnd + (dataLength & 1)
    if (nextOffset > bytes.length) throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    if (type === 'ANIM' || type === 'ANMF') {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    if (type === 'VP8X' && (dataLength < 1 || (bytes[dataStart] & 0x02) !== 0)) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    if (type === 'VP8 ' || type === 'VP8L') sawStillImage = true
    offset = nextOffset
  }
  if (!sawStillImage || offset !== bytes.length) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
}

function sharpFormatFor(mimeType: ImageMimeType): string {
  return mimeType.slice('image/'.length)
}

async function normalizeImage(
  original: Buffer,
  mimeType: ImageMimeType,
  config: InvoiceDocumentProcessorConfig,
): Promise<Buffer> {
  const deadline = operationDeadline(config, MAX_INSPECTION_TIMEOUT_MS)
  try {
    if (mimeType === 'image/png') validateStaticPngStructure(original)
    else if (mimeType === 'image/jpeg') validateJpegBoundary(original)
    else validateStaticWebpStructure(original)
    remainingMilliseconds(deadline, config.signal)
    const metadata = await sharp(original, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: false,
    }).timeout({ seconds: remainingSharpSeconds(deadline, config.signal) }).metadata()
    remainingMilliseconds(deadline, config.signal)
    if (
      metadata.format !== sharpFormatFor(mimeType) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
    }
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new InvoiceDocumentProcessorError('IMAGE_TOO_LARGE')
    }
    const normalized = await sharp(original, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .resize({ width: 2_000, height: 2_000, fit: 'inside', withoutEnlargement: true })
      .png()
      .timeout({ seconds: remainingSharpSeconds(deadline, config.signal) })
      .toBuffer()
    remainingMilliseconds(deadline, config.signal)
    if (normalized.byteLength === 0 || normalized.byteLength > MAX_NORMALIZED_IMAGE_BYTES) {
      throw new InvoiceDocumentProcessorError('OUTPUT_LIMIT')
    }
    return normalized
  } catch (error) {
    if (error instanceof InvoiceDocumentProcessorError) throw error
    if (config.signal?.aborted) throw new InvoiceDocumentProcessorError('ABORTED')
    if (performance.now() >= deadline || isSharpTimeout(error)) {
      throw new InvoiceDocumentProcessorError('PROCESS_TIMEOUT')
    }
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
}

async function inspectImage(
  original: Buffer,
  mimeType: ImageMimeType,
  config: InvoiceDocumentProcessorConfig,
): Promise<{ metadata: InvoiceDocumentMetadata; normalized: Buffer }> {
  const normalized = await normalizeImage(original, mimeType, config)
  return {
    metadata: {
      mimeType,
      byteSize: original.byteLength,
      sha256: createHash('sha256').update(original).digest('hex'),
      pageCount: null,
    },
    normalized,
  }
}

/**
 * The operator owns the local parent filesystem. Node has no openat-style
 * mkdtemp primitive, so concurrent replacement by an actor controlling that
 * trusted parent remains outside this module's boundary.
 */
async function ensureSafeWorkRoot(workRoot: string): Promise<string> {
  try {
    const normalized = resolve(workRoot)
    const parentInfo = await lstat(dirname(normalized))
    const rootInfo = await lstat(normalized)
    if (
      parentInfo.isSymbolicLink() ||
      !parentInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      !rootInfo.isDirectory()
    ) {
      throw new InvoiceDocumentProcessorError('UNSAFE_WORK_ROOT')
    }
    return normalized
  } catch (error) {
    if (error instanceof InvoiceDocumentProcessorError) throw error
    throw new InvoiceDocumentProcessorError('UNSAFE_WORK_ROOT')
  }
}

interface NativeProcessResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number | null
}

/** Resolves or rejects only after `close`, so descendant pipes are settled before cleanup. */
function executeNative(
  binary: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
): Promise<NativeProcessResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new InvoiceDocumentProcessorError('ABORTED'))
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const childEnvironment = {
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      HOME: options.cwd,
      TMPDIR: options.cwd,
    } as unknown as NodeJS.ProcessEnv
    const child = spawn(binary, args, {
      cwd: options.cwd,
      detached: true,
      shell: false,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputSize = 0
    let failure: InvoiceDocumentProcessorError | null = null

    const killGroup = () => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') {
          try {
            child.kill('SIGKILL')
          } catch {
            // The close/error handlers own the generic outcome.
          }
        }
      }
    }
    const stop = (code: InvoiceDocumentProcessorErrorCode) => {
      failure ??= new InvoiceDocumentProcessorError(code)
      killGroup()
    }
    const onAbort = () => stop('ABORTED')
    const timer = setTimeout(() => stop('PROCESS_TIMEOUT'), options.timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const consume = (target: Buffer[]) => (chunk: Buffer) => {
      if (failure) return
      outputSize += chunk.byteLength
      if (outputSize > MAX_PROCESS_OUTPUT_BYTES) stop('OUTPUT_LIMIT')
      else target.push(Buffer.from(chunk))
    }
    child.stdout.on('data', consume(stdout))
    child.stderr.on('data', consume(stderr))
    child.on('error', () => {
      failure ??= new InvoiceDocumentProcessorError('PROCESS_FAILURE')
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (failure) rejectPromise(failure)
      else {
        resolvePromise({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          exitCode,
        })
      }
    })
    if (options.signal?.aborted) onAbort()
  })
}

async function validateExecutable(binary: string): Promise<void> {
  try {
    const info = await lstat(binary)
    if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o111) === 0) {
      throw new InvoiceDocumentProcessorError('INVALID_CONFIG')
    }
  } catch (error) {
    if (error instanceof InvoiceDocumentProcessorError) throw error
    throw new InvoiceDocumentProcessorError('INVALID_CONFIG')
  }
}

function sha256Metadata(
  original: Buffer,
  mimeType: InvoiceAttachmentMimeType,
  pageCount: number | null,
): InvoiceDocumentMetadata {
  return {
    mimeType,
    byteSize: original.byteLength,
    sha256: createHash('sha256').update(original).digest('hex'),
    pageCount,
  }
}

async function inspectPdf(
  original: Buffer,
  config: InvoiceDocumentProcessorConfig,
  jobDirectory: string,
): Promise<{ metadata: InvoiceDocumentMetadata; sourcePath: string }> {
  const deadline = operationDeadline(config, MAX_INSPECTION_TIMEOUT_MS)
  await validateExecutable(config.pdfInfoBinary)
  remainingMilliseconds(deadline, config.signal)
  const sourcePath = join(jobDirectory, 'source.pdf')
  await writeFile(sourcePath, original, { flag: 'wx', mode: PRIVATE_FILE_MODE })
  remainingMilliseconds(deadline, config.signal)
  const result = await executeNative(config.pdfInfoBinary, [sourcePath], {
    cwd: jobDirectory,
    signal: config.signal,
    timeoutMs: remainingMilliseconds(deadline, config.signal),
  })
  remainingMilliseconds(deadline, config.signal)
  const stderr = result.stderr.toString('utf8')
  if (result.exitCode !== 0) {
    if (/password|encrypted/i.test(stderr)) {
      throw new InvoiceDocumentProcessorError('PDF_ENCRYPTED')
    }
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
  const outputLines = result.stdout.toString('utf8').split(/\r?\n/)
  const encryptedLines = outputLines.filter((line) => line.startsWith('Encrypted:'))
  const encryptedMatch = encryptedLines.length === 1
    ? /^Encrypted:\s+(yes|no)(?:\s+.*)?$/i.exec(encryptedLines[0])
    : null
  if (!encryptedMatch) throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  if (encryptedMatch[1].toLowerCase() !== 'no') {
    throw new InvoiceDocumentProcessorError('PDF_ENCRYPTED')
  }
  const pageLines = outputLines.filter((line) => line.startsWith('Pages:'))
  const pageMatch = pageLines.length === 1 ? /^Pages:\s+(\d+)\s*$/.exec(pageLines[0]) : null
  const pageCount = pageMatch === null ? Number.NaN : Number(pageMatch[1])
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
  if (pageCount > INVOICE_ATTACHMENT_MAX_PDF_PAGES) {
    throw new InvoiceDocumentProcessorError('PDF_PAGE_LIMIT')
  }
  return {
    metadata: sha256Metadata(original, 'application/pdf', pageCount),
    sourcePath,
  }
}

async function verifyRenderedImage(
  imagePath: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<number> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    remainingMilliseconds(deadline, signal)
    handle = await open(imagePath, READ_NOFOLLOW_FLAGS)
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > MAX_NORMALIZED_IMAGE_BYTES) {
      throw new InvoiceDocumentProcessorError('OUTPUT_LIMIT')
    }
    const bytes = await handle.readFile()
    remainingMilliseconds(deadline, signal)
    if (bytes.byteLength !== info.size) throw new InvoiceDocumentProcessorError('PROCESS_FAILURE')
    const metadata = await sharp(bytes, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: false,
    }).timeout({ seconds: remainingSharpSeconds(deadline, signal) }).metadata()
    remainingMilliseconds(deadline, signal)
    if (
      metadata.format !== 'png' ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_RENDERED_IMAGE_PIXELS
    ) {
      throw new InvoiceDocumentProcessorError('PROCESS_FAILURE')
    }
    await sharp(bytes, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_RENDERED_IMAGE_PIXELS,
    }).raw().timeout({ seconds: remainingSharpSeconds(deadline, signal) }).toBuffer()
    remainingMilliseconds(deadline, signal)
    return info.size
  } catch (error) {
    if (error instanceof InvoiceDocumentProcessorError) throw error
    if (signal?.aborted) throw new InvoiceDocumentProcessorError('ABORTED')
    if (performance.now() >= deadline || isSharpTimeout(error)) {
      throw new InvoiceDocumentProcessorError('PROCESS_TIMEOUT')
    }
    throw new InvoiceDocumentProcessorError('PROCESS_FAILURE')
  } finally {
    try {
      await handle?.close()
    } catch {
      // A generic processing failure already protects the caller from the file.
    }
  }
}

async function renderPdf(
  inspected: { metadata: InvoiceDocumentMetadata; sourcePath: string },
  config: InvoiceDocumentProcessorConfig,
  jobDirectory: string,
): Promise<readonly string[]> {
  const deadline = operationDeadline(config, MAX_RENDER_TIMEOUT_MS)
  await validateExecutable(config.pdfToPpmBinary)
  remainingMilliseconds(deadline, config.signal)
  const pageCount = inspected.metadata.pageCount
  if (pageCount === null) throw new InvoiceDocumentProcessorError('PROCESS_FAILURE')
  const outputPrefix = join(jobDirectory, 'page')
  const result = await executeNative(config.pdfToPpmBinary, [
    '-png',
    '-r',
    '144',
    '-scale-to',
    '2000',
    '-f',
    '1',
    '-l',
    String(pageCount),
    inspected.sourcePath,
    outputPrefix,
  ], {
    cwd: jobDirectory,
    signal: config.signal,
    timeoutMs: remainingMilliseconds(deadline, config.signal),
  })
  remainingMilliseconds(deadline, config.signal)
  if (result.exitCode !== 0) throw new InvoiceDocumentProcessorError('PROCESS_FAILURE')

  const pageNumberWidth = String(pageCount).length
  const expectedNames = Array.from(
    { length: pageCount },
    (_, index) => `page-${String(index + 1).padStart(pageNumberWidth, '0')}.png`,
  )
  const actualNames = (await readdir(jobDirectory))
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
  remainingMilliseconds(deadline, config.signal)
  if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new InvoiceDocumentProcessorError('PROCESS_FAILURE')
  }

  const imagePaths = expectedNames.map((name) => join(jobDirectory, name))
  let totalBytes = 0
  for (const imagePath of imagePaths) {
    remainingMilliseconds(deadline, config.signal)
    totalBytes += await verifyRenderedImage(imagePath, deadline, config.signal)
    if (totalBytes > MAX_RENDERED_TOTAL_BYTES) {
      throw new InvoiceDocumentProcessorError('OUTPUT_LIMIT')
    }
    await chmod(imagePath, PRIVATE_FILE_MODE)
    remainingMilliseconds(deadline, config.signal)
  }
  return Object.freeze(imagePaths)
}

async function createJobDirectory(config: InvoiceDocumentProcessorConfig): Promise<string> {
  const workRoot = await ensureSafeWorkRoot(config.workRoot)
  let jobDirectory: string | undefined
  try {
    jobDirectory = await mkdtemp(join(workRoot, 'invoice-document-'))
    await chmod(jobDirectory, PRIVATE_DIRECTORY_MODE)
    return jobDirectory
  } catch (error) {
    if (jobDirectory) await removeJobDirectory(jobDirectory)
    throw genericProcessingError(error)
  }
}

async function removeJobDirectory(jobDirectory: string): Promise<void> {
  try {
    await rm(jobDirectory, { recursive: true, force: true })
  } catch {
    throw new InvoiceDocumentProcessorError('CLEANUP_FAILURE')
  }
}

export async function inspectInvoiceDocument(
  bytes: Uint8Array,
  config: InvoiceDocumentProcessorConfig,
): Promise<InvoiceDocumentMetadata> {
  validateConfig(config)
  if (config.signal?.aborted) throw new InvoiceDocumentProcessorError('ABORTED')
  if (!isByteView(bytes) || bytes.byteLength === 0) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
  if (bytes.byteLength > INVOICE_ATTACHMENT_MAX_BYTES) {
    throw new InvoiceDocumentProcessorError('DOCUMENT_TOO_LARGE')
  }
  await ensureSafeWorkRoot(config.workRoot)

  const original = Buffer.from(bytes)
  const mimeType = detectImageMimeType(original)
  if (mimeType) return (await inspectImage(original, mimeType, config)).metadata
  if (!isPdf(original)) throw new InvoiceDocumentProcessorError('UNSUPPORTED_TYPE')

  let jobDirectory: string | undefined
  try {
    jobDirectory = await createJobDirectory(config)
    return (await inspectPdf(original, config, jobDirectory)).metadata
  } catch (error) {
    throw genericProcessingError(error)
  } finally {
    if (jobDirectory) await removeJobDirectory(jobDirectory)
  }
}

export async function withInvoiceDocumentImages<T>(
  bytes: Uint8Array,
  config: InvoiceDocumentProcessorConfig,
  callback: (imagePaths: readonly string[], metadata: InvoiceDocumentMetadata) => Promise<T>,
): Promise<T> {
  validateConfig(config)
  if (typeof callback !== 'function') throw new InvoiceDocumentProcessorError('INVALID_CONFIG')
  if (config.signal?.aborted) throw new InvoiceDocumentProcessorError('ABORTED')
  if (!isByteView(bytes) || bytes.byteLength === 0) {
    throw new InvoiceDocumentProcessorError('INVALID_DOCUMENT')
  }
  if (bytes.byteLength > INVOICE_ATTACHMENT_MAX_BYTES) {
    throw new InvoiceDocumentProcessorError('DOCUMENT_TOO_LARGE')
  }

  let jobDirectory: string | undefined
  let callbackError: unknown
  let callbackStarted = false
  try {
    jobDirectory = await createJobDirectory(config)

    const original = Buffer.from(bytes)
    const mimeType = detectImageMimeType(original)
    let metadata: InvoiceDocumentMetadata
    let imagePaths: readonly string[]
    if (mimeType) {
      const inspected = await inspectImage(original, mimeType, config)
      const imagePath = join(jobDirectory, 'page-1.png')
      await writeFile(imagePath, inspected.normalized, { flag: 'wx', mode: PRIVATE_FILE_MODE })
      metadata = inspected.metadata
      imagePaths = Object.freeze([imagePath])
    } else if (isPdf(original)) {
      const inspected = await inspectPdf(original, config, jobDirectory)
      metadata = inspected.metadata
      imagePaths = await renderPdf(inspected, config, jobDirectory)
    } else {
      throw new InvoiceDocumentProcessorError('UNSUPPORTED_TYPE')
    }
    if (config.signal?.aborted) throw new InvoiceDocumentProcessorError('ABORTED')
    callbackStarted = true
    return await callback(imagePaths, metadata)
  } catch (error) {
    callbackError = callbackStarted ? error : genericProcessingError(error)
    throw callbackError
  } finally {
    if (jobDirectory) {
      try {
        await removeJobDirectory(jobDirectory)
      } catch {
        if (!(callbackError instanceof InvoiceDocumentProcessorError && callbackError.code === 'CLEANUP_FAILURE')) {
          throw new InvoiceDocumentProcessorError('CLEANUP_FAILURE')
        }
      }
    }
  }
}
