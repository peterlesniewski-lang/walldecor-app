// @vitest-environment node
import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as setTimeoutPromise } from 'node:timers/promises'
import { jsPDF } from 'jspdf'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  inspectInvoiceDocument,
  withInvoiceDocumentImages,
  type InvoiceDocumentProcessorConfig,
} from '@/lib/invoice-import/document-processor'

const NATIVE_BIN_ROOT = '/Users/piotr/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override'
const realDelay = setTimeoutPromise

let sandbox: string
let workRoot: string
let config: InvoiceDocumentProcessorConfig

function pdfWithPages(pageCount: number, encrypted = false): Buffer {
  const document = new jsPDF(encrypted ? {
    encryption: {
      userPassword: 'secret',
      ownerPassword: 'owner',
      userPermissions: ['print'],
    },
  } : undefined)
  for (let page = 1; page <= pageCount; page += 1) {
    if (page > 1) document.addPage()
  }
  if (pageCount === 0) document.deletePage(1)
  return Buffer.from(document.output('arraybuffer'))
}

function pdfWithInjectedMetadata(): Buffer {
  const document = new jsPDF()
  document.setProperties({
    title: 'SECRET_PDF_METADATA_DO_NOT_EXPOSE\nPages: 99\nEncrypted: no',
  })
  return Buffer.from(document.output('arraybuffer'))
}

async function fakeNativeBinary(name: string, body: string): Promise<string> {
  const binary = path.join(sandbox, name)
  await writeFile(binary, `#!${process.execPath}\n${body}\n`, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

function assertProcessGone(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrow()
}

async function waitForProcessAudit(auditPath: string): Promise<{ pid: number; childPid: number }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      const audit = JSON.parse(await readFile(auditPath, 'utf8')) as {
        pid: number
        childPid: number
      }
      if (audit.pid > 0 && audit.childPid > 0) return audit
      lastError = new Error('Process audit did not contain both PIDs')
    } catch (error) {
      lastError = error
    }
    await realDelay(10)
  }
  throw lastError
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'ascii')
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])))
  return Buffer.concat([header, data, checksum])
}

function parsePngChunks(bytes: Buffer): Array<{ type: string; data: Buffer; raw: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer; raw: Buffer }> = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    chunks.push({
      type: bytes.toString('ascii', offset + 4, offset + 8),
      data: bytes.subarray(offset + 8, offset + 8 + length),
      raw: bytes.subarray(offset, offset + 12 + length),
    })
    offset += length + 12
  }
  return chunks
}

async function realTwoFrameApng(): Promise<Buffer> {
  const first = await sharp({
    create: { width: 2, height: 2, channels: 4, background: 'red' },
  }).png().toBuffer()
  const second = await sharp({
    create: { width: 2, height: 2, channels: 4, background: 'blue' },
  }).png().toBuffer()
  const firstChunks = parsePngChunks(first)
  const secondChunks = parsePngChunks(second)
  const animationControl = Buffer.alloc(8)
  animationControl.writeUInt32BE(2, 0)
  const frameControl = (sequence: number) => {
    const data = Buffer.alloc(26)
    data.writeUInt32BE(sequence, 0)
    data.writeUInt32BE(2, 4)
    data.writeUInt32BE(2, 8)
    data.writeUInt16BE(1, 20)
    data.writeUInt16BE(10, 22)
    return pngChunk('fcTL', data)
  }
  const frameDataSequence = Buffer.alloc(4)
  frameDataSequence.writeUInt32BE(2)
  const firstIdat = firstChunks.filter((chunk) => chunk.type === 'IDAT')
  const secondIdatData = secondChunks
    .filter((chunk) => chunk.type === 'IDAT')
    .map((chunk) => chunk.data)

  return Buffer.concat([
    first.subarray(0, 8),
    firstChunks.find((chunk) => chunk.type === 'IHDR')!.raw,
    pngChunk('acTL', animationControl),
    frameControl(0),
    ...firstIdat.map((chunk) => chunk.raw),
    frameControl(1),
    pngChunk('fdAT', Buffer.concat([frameDataSequence, ...secondIdatData])),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'invoice-document-processor-test-'))
  workRoot = path.join(sandbox, 'work')
  await mkdir(workRoot, { mode: 0o700 })
  config = {
    pdfInfoBinary: path.join(NATIVE_BIN_ROOT, 'pdfinfo'),
    pdfToPpmBinary: path.join(NATIVE_BIN_ROOT, 'pdftoppm'),
    workRoot,
  }
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(sandbox, { recursive: true, force: true })
})

describe('invoice document processor', () => {
  it('detects and fully validates a PNG from bytes, independent of any declared MIME', async () => {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 4, background: '#aabbccdd' },
    }).png().toBuffer()

    await expect(inspectInvoiceDocument(bytes, config)).resolves.toEqual({
      mimeType: 'image/png',
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pageCount: null,
    })
  })

  it.each([
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('detects a real single-frame %s and normalizes it to a bounded PNG', async (format, mimeType) => {
    const sentinelPath = path.join(workRoot, 'operator-sentinel')
    await writeFile(sentinelPath, 'PRESERVE', { mode: 0o600 })
    const source = sharp({
      create: { width: 3_000, height: 1_500, channels: 3, background: '#395979' },
    })
    const bytes = await source[format]().toBuffer()
    let callbackPath = ''

    const result = await withInvoiceDocumentImages(bytes, config, async (imagePaths, metadata) => {
      expect(metadata).toMatchObject({ mimeType, pageCount: null })
      expect(imagePaths).toHaveLength(1)
      callbackPath = imagePaths[0]
      expect((await stat(path.dirname(callbackPath))).mode & 0o777).toBe(0o700)
      expect((await stat(callbackPath)).mode & 0o777).toBe(0o600)
      const normalized = await sharp(await readFile(callbackPath)).metadata()
      expect(normalized).toMatchObject({ format: 'png', width: 2_000, height: 1_000 })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await expect(readFile(callbackPath)).resolves.toBeInstanceOf(Buffer)
      return `processed-${format}`
    })

    expect(result).toBe(`processed-${format}`)
    await expect(lstat(callbackPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(sentinelPath, 'utf8')).toBe('PRESERVE')
    expect(await readdir(workRoot)).toEqual(['operator-sentinel'])
  })

  it('does not mutate, upscale, or flatten alpha in a source picture', async () => {
    const bytes = await sharp({
      create: { width: 9, height: 7, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 0 } },
    }).png().toBuffer()
    const exactOriginal = Buffer.from(bytes)

    await withInvoiceDocumentImages(bytes, config, async ([imagePath]) => {
      const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true })
      expect(info).toMatchObject({ width: 9, height: 7, channels: 4 })
      expect(data[3]).toBe(0)
    })

    expect(bytes).toEqual(exactOriginal)
  })

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')],
    ['GIF', Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64')],
  ])('rejects unsupported %s bytes before decoding', async (_label, bytes) => {
    await expect(inspectInvoiceDocument(bytes, config)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
      message: 'UNSUPPORTED_TYPE',
    })
  })

  it.each([
    ['a fake PNG signature', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['a truncated JPEG', Buffer.from('ffd8ffe000104a464946000101', 'hex')],
    ['a fake WebP container', Buffer.from('524946460400000057454250', 'hex')],
  ])('rejects %s after content parsing', async (_label, bytes) => {
    await expect(inspectInvoiceDocument(bytes, config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
      message: 'INVALID_DOCUMENT',
    })
  })

  it('rejects animated WebP content even though its outer magic is allowed', async () => {
    const frames = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255])
    const animated = await sharp(frames, {
      raw: { width: 1, height: 2, pageHeight: 1, channels: 4 },
    }).webp({ loop: 0, delay: [100, 100] }).toBuffer()

    await expect(inspectInvoiceDocument(animated, config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    })
  })

  it('rejects a structurally valid two-frame APNG even when Sharp omits page metadata', async () => {
    const animated = await realTwoFrameApng()
    expect(await sharp(animated, { animated: true }).metadata()).not.toHaveProperty('pages')

    await expect(inspectInvoiceDocument(animated, config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
      message: 'INVALID_DOCUMENT',
    })
  })

  it('rejects PNG content truncated exactly before its final IEND chunk', async () => {
    const complete = await sharp({
      create: { width: 3, height: 3, channels: 4, background: '#12345678' },
    }).png().toBuffer()
    expect(complete.subarray(-12)).toEqual(pngChunk('IEND', Buffer.alloc(0)))

    await expect(inspectInvoiceDocument(complete.subarray(0, -12), config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
      message: 'INVALID_DOCUMENT',
    })
  })

  it('rejects JPEG without final EOI or with trailing data and WebP with a mismatched RIFF length', async () => {
    const jpeg = await sharp({
      create: { width: 3, height: 3, channels: 3, background: '#123456' },
    }).jpeg().toBuffer()
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))
    await expect(inspectInvoiceDocument(jpeg.subarray(0, -2), config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    })
    await expect(inspectInvoiceDocument(Buffer.concat([jpeg, Buffer.from('TRAILING')]), config))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })

    const webp = await sharp({
      create: { width: 3, height: 3, channels: 3, background: '#123456' },
    }).webp().toBuffer()
    await expect(inspectInvoiceDocument(webp.subarray(0, -1), config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    })
    await expect(inspectInvoiceDocument(Buffer.concat([webp, Buffer.from([0])]), config))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('does not accept a Sharp result completed after a lowered absolute deadline', async () => {
    const bytes = await sharp({
      create: { width: 2_000, height: 2_000, channels: 4, background: '#abcdef88' },
    }).png().toBuffer()

    await expect(inspectInvoiceDocument(bytes, { ...config, timeoutMs: 1 })).rejects.toMatchObject({
      code: 'PROCESS_TIMEOUT',
      message: 'PROCESS_TIMEOUT',
    })
  })

  it('clears processing deadlines before entering the caller callback', async () => {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#fff' },
    }).png().toBuffer()

    await expect(withInvoiceDocumentImages(bytes, { ...config, timeoutMs: 500 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 550))
      return 'callback-finished'
    })).resolves.toBe('callback-finished')
  })

  it('rejects document-byte and decoded-pixel limits with distinct typed errors', async () => {
    await expect(
      inspectInvoiceDocument(Buffer.alloc(10 * 1024 * 1024 + 1), config),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' })

    const tooManyPixels = await sharp({
      create: { width: 6_401, height: 6_250, channels: 3, background: '#fff' },
    }).png({ compressionLevel: 9 }).toBuffer()
    expect(tooManyPixels.byteLength).toBeLessThan(10 * 1024 * 1024)
    await expect(inspectInvoiceDocument(tooManyPixels, config)).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    })
  })

  it('uses real pdfinfo and pdftoppm to inspect and deterministically render exactly two pages', async () => {
    const bytes = pdfWithPages(2)
    const exactOriginal = Buffer.from(bytes)
    const inspected = await inspectInvoiceDocument(bytes, config)

    expect(inspected).toEqual({
      mimeType: 'application/pdf',
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pageCount: 2,
    })

    const render = async () => withInvoiceDocumentImages(bytes, config, async (imagePaths, metadata) => {
      expect(metadata).toEqual(inspected)
      expect(imagePaths.map((imagePath) => path.basename(imagePath))).toEqual([
        'page-1.png',
        'page-2.png',
      ])
      const sourcePath = path.join(path.dirname(imagePaths[0]), 'source.pdf')
      expect((await stat(sourcePath)).mode & 0o777).toBe(0o600)
      const pages = await Promise.all(imagePaths.map(async (imagePath) => {
        const imageBytes = await readFile(imagePath)
        expect(imageBytes.byteLength).toBeLessThanOrEqual(25 * 1024 * 1024)
        const pageMetadata = await sharp(imageBytes).metadata()
        expect(pageMetadata.format).toBe('png')
        expect((pageMetadata.width ?? 0) * (pageMetadata.height ?? 0)).toBeLessThanOrEqual(4_000_000)
        return imageBytes
      }))
      expect(pages.reduce((sum, page) => sum + page.byteLength, 0)).toBeLessThanOrEqual(60 * 1024 * 1024)
      return pages
    })

    const first = await render()
    const second = await render()
    expect(first).toEqual(second)
    expect(bytes).toEqual(exactOriginal)
    expect(await readdir(workRoot)).toEqual([])
  }, 30_000)

  it('accepts real ten-page Poppler output in canonical zero-padded numeric order', async () => {
    const bytes = pdfWithPages(10)

    const pageNames = await withInvoiceDocumentImages(bytes, config, async (imagePaths, metadata) => {
      expect(metadata.pageCount).toBe(10)
      return imagePaths.map((imagePath) => path.basename(imagePath))
    })

    expect(pageNames).toEqual([
      'page-01.png',
      'page-02.png',
      'page-03.png',
      'page-04.png',
      'page-05.png',
      'page-06.png',
      'page-07.png',
      'page-08.png',
      'page-09.png',
      'page-10.png',
    ])
    expect(await readdir(workRoot)).toEqual([])
  }, 30_000)

  it('uses real pdfinfo to reject encrypted, zero-page, over-page-limit, and malformed PDFs generically', async () => {
    const cases: Array<[string, Buffer, string]> = [
      ['encrypted', pdfWithPages(1, true), 'PDF_ENCRYPTED'],
      ['zero-page', pdfWithPages(0), 'INVALID_DOCUMENT'],
      ['eleven-page', pdfWithPages(11), 'PDF_PAGE_LIMIT'],
      ['metadata-injection', pdfWithInjectedMetadata(), 'INVALID_DOCUMENT'],
      ['malformed', Buffer.from('%PDF-1.7\nSECRET_PDF_METADATA_DO_NOT_EXPOSE\n'), 'INVALID_DOCUMENT'],
    ]

    for (const [label, bytes, code] of cases) {
      const failure = await inspectInvoiceDocument(bytes, config).catch((error: unknown) => error)
      expect(failure, label).toMatchObject({ code, message: code })
      expect(String((failure as Error).message)).not.toContain('SECRET_PDF_METADATA_DO_NOT_EXPOSE')
      expect(await readdir(workRoot)).toEqual([])
    }
  }, 30_000)

  it('launches pdfinfo with only the fixed safe environment and a private internal source path', async () => {
    const auditPath = path.join(sandbox, 'pdfinfo-env-audit.json')
    const binary = await fakeNativeBinary('env-pdfinfo', `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ env: process.env, cwd: process.cwd(), args: process.argv.slice(2) }));
process.stdout.write('Pages: 1\\nEncrypted: no\\n');
`)
    vi.stubEnv('DATABASE_URL', 'DO_NOT_INHERIT')
    vi.stubEnv('AI_WORKER_SECRET', 'DO_NOT_INHERIT')
    vi.stubEnv('OPENAI_API_KEY', 'DO_NOT_INHERIT')
    vi.stubEnv('CODEX_HOME', 'DO_NOT_INHERIT')

    await expect(inspectInvoiceDocument(pdfWithPages(1), {
      ...config,
      pdfInfoBinary: binary,
    })).resolves.toMatchObject({ mimeType: 'application/pdf', pageCount: 1 })

    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    const platformInjectedTextEncoding = audit.env.__CF_USER_TEXT_ENCODING
    delete audit.env.__CF_USER_TEXT_ENCODING
    expect(audit.env).toEqual({
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      HOME: audit.env.HOME,
      TMPDIR: audit.env.HOME,
    })
    if (process.platform === 'darwin') expect(platformInjectedTextEncoding).toMatch(/^0x/)
    else expect(platformInjectedTextEncoding).toBeUndefined()
    expect(audit.env.HOME).toBe(audit.env.TMPDIR)
    expect(await realpath(path.dirname(audit.env.HOME))).toBe(await realpath(workRoot))
    expect(audit.args).toEqual([path.join(audit.env.HOME, 'source.pdf')])
    expect(await readdir(workRoot)).toEqual([])
  })

  it('rejects missing or duplicated canonical pdfinfo fields and bounded raw diagnostics', async () => {
    const outputs = [
      ['missing-encrypted', 'Pages: 1\n'],
      ['duplicate-pages', 'Pages: 1\nPages: 2\nEncrypted: no\n'],
      ['duplicate-encrypted', 'Pages: 1\nEncrypted: no\nEncrypted: no\n'],
    ]
    for (const [name, output] of outputs) {
      const binary = await fakeNativeBinary(name, `process.stdout.write(${JSON.stringify(output)});`)
      await expect(inspectInvoiceDocument(pdfWithPages(1), {
        ...config,
        pdfInfoBinary: binary,
      })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT', message: 'INVALID_DOCUMENT' })
    }

    const rawFailure = await fakeNativeBinary('raw-failure', `
process.stderr.write('SECRET_RAW_PDF_DIAGNOSTIC');
process.exit(7);
`)
    const error = await inspectInvoiceDocument(pdfWithPages(1), {
      ...config,
      pdfInfoBinary: rawFailure,
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'INVALID_DOCUMENT', message: 'INVALID_DOCUMENT' })
    expect(String((error as Error).message)).not.toContain('SECRET_RAW_PDF_DIAGNOSTIC')
    expect(await readdir(workRoot)).toEqual([])
  })

  it('bounds combined pdfinfo output and cleans the exact private job directory', async () => {
    const binary = await fakeNativeBinary(
      'overflow-pdfinfo',
      `process.stdout.write('x'.repeat(64 * 1024 + 1));`,
    )

    await expect(inspectInvoiceDocument(pdfWithPages(1), {
      ...config,
      pdfInfoBinary: binary,
    })).rejects.toMatchObject({ code: 'OUTPUT_LIMIT', message: 'OUTPUT_LIMIT' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('kills its native process group on timeout and waits for close before cleanup', async () => {
    const auditPath = path.join(sandbox, 'timeout-audit.json')
    const binary = await fakeNativeBinary('hanging-pdfinfo', `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
fs.writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ pid: process.pid, childPid: child.pid }));
setInterval(() => {}, 1000);
`)
    const controller = new AbortController()
    vi.useFakeTimers()
    const running = inspectInvoiceDocument(pdfWithPages(1), {
      ...config,
      pdfInfoBinary: binary,
      timeoutMs: 30_000,
      signal: controller.signal,
    })
    const observedOutcome = running.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )

    try {
      const audit = await waitForProcessAudit(auditPath)
      await vi.advanceTimersByTimeAsync(30_000)
      const outcome = await observedOutcome
      expect(outcome.status).toBe('rejected')
      if (outcome.status !== 'rejected') {
        throw new Error('Expected native process timeout, but processing fulfilled')
      }
      expect(outcome.error).toMatchObject({
        code: 'PROCESS_TIMEOUT',
        message: 'PROCESS_TIMEOUT',
      })

      assertProcessGone(audit.pid)
      assertProcessGone(audit.childPid)
      expect(await readdir(workRoot)).toEqual([])
    } finally {
      controller.abort()
      await observedOutcome
      vi.useRealTimers()
    }
  }, 10_000)

  it('kills its native process group on abort without exposing the abort reason', async () => {
    const auditPath = path.join(sandbox, 'abort-audit.json')
    const binary = await fakeNativeBinary('abortable-pdfinfo', `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
fs.writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ pid: process.pid, childPid: child.pid }));
setInterval(() => {}, 1000);
`)
    const controller = new AbortController()
    const running = inspectInvoiceDocument(pdfWithPages(1), {
      ...config,
      pdfInfoBinary: binary,
      signal: controller.signal,
    })
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(auditPath, 'utf8')).pid).toBeGreaterThan(0)
    })
    controller.abort(new Error('SECRET_ABORT_REASON'))

    const error = await running.catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'ABORTED', message: 'ABORTED' })
    expect(String((error as Error).message)).not.toContain('SECRET_ABORT_REASON')
    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    assertProcessGone(audit.pid)
    assertProcessGone(audit.childPid)
    expect(await readdir(workRoot)).toEqual([])
  })

  it('rejects missing, duplicate, malformed, oversized, or outside rendered page outputs', async () => {
    const fixturePng = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#fff' },
    }).png().toBuffer()
    const renderers = [
      ['missing', ''],
      ['malformed', `require('node:fs').writeFileSync(process.argv.at(-1) + '-1.png', Buffer.from('89504e470d0a1a0a', 'hex'));`],
      ['outside', `const fs=require('node:fs'); const p=process.argv.at(-1); const b=Buffer.from(${JSON.stringify(fixturePng.toString('base64'))}, 'base64'); fs.writeFileSync(p + '-1.png', b); fs.writeFileSync(p + '-2.png', b);`],
      ['oversized', `require('node:fs').writeFileSync(process.argv.at(-1) + '-1.png', Buffer.alloc(25 * 1024 * 1024 + 1));`],
    ]

    for (const [name, body] of renderers) {
      const renderer = await fakeNativeBinary(`renderer-${name}`, body)
      const expectedCode = name === 'oversized' ? 'OUTPUT_LIMIT' : 'PROCESS_FAILURE'
      await expect(withInvoiceDocumentImages(pdfWithPages(1), {
        ...config,
        pdfToPpmBinary: renderer,
      }, async () => undefined)).rejects.toMatchObject({ code: expectedCode, message: expectedCode })
      expect(await readdir(workRoot)).toEqual([])
    }
  }, 30_000)

  it('rejects symbolic-link work roots and immediate parents before creating a job', async () => {
    const image = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#fff' },
    }).png().toBuffer()
    const linkedRoot = path.join(sandbox, 'linked-work')
    await symlink(workRoot, linkedRoot, 'dir')
    await expect(inspectInvoiceDocument(image, { ...config, workRoot: linkedRoot })).rejects.toMatchObject({
      code: 'UNSAFE_WORK_ROOT',
    })

    const actualParent = path.join(sandbox, 'actual-parent')
    const linkedParent = path.join(sandbox, 'linked-parent')
    await mkdir(path.join(actualParent, 'nested-work'), { recursive: true, mode: 0o700 })
    await symlink(actualParent, linkedParent, 'dir')
    await expect(inspectInvoiceDocument(image, {
      ...config,
      workRoot: path.join(linkedParent, 'nested-work'),
    })).rejects.toMatchObject({ code: 'UNSAFE_WORK_ROOT' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('validates bytes-only input and absolute operator configuration without side effects', async () => {
    await expect(inspectInvoiceDocument(Buffer.alloc(0), config)).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    })
    await expect(inspectInvoiceDocument(
      new Uint16Array([0x5044]) as unknown as Uint8Array,
      config,
    )).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(inspectInvoiceDocument(Buffer.from('\n%PDF-1.7'), config)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    })
    await expect(inspectInvoiceDocument(Buffer.from('89504e470d0a1a0a', 'hex'), {
      ...config,
      pdfInfoBinary: 'relative/pdfinfo',
    })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('keeps callback failures distinct but reports and leaves a recoverable exact directory on cleanup failure', async () => {
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#fff' },
    }).png().toBuffer()
    const callbackFailure = new Error('CALLER_FAILURE')
    await expect(withInvoiceDocumentImages(image, config, async () => {
      throw callbackFailure
    })).rejects.toBe(callbackFailure)
    expect(await readdir(workRoot)).toEqual([])

    let ownedDirectory = ''
    await expect(withInvoiceDocumentImages(image, config, async ([imagePath]) => {
      ownedDirectory = path.dirname(imagePath)
      await chmod(ownedDirectory, 0o500)
    })).rejects.toMatchObject({ code: 'CLEANUP_FAILURE', message: 'CLEANUP_FAILURE' })

    await chmod(ownedDirectory, 0o700)
    await rm(ownedDirectory, { recursive: true, force: true })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('maps private-work filesystem failures to typed generic processing errors', async () => {
    const image = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#fff' },
    }).png().toBuffer()
    await chmod(workRoot, 0o500)
    try {
      const error = await withInvoiceDocumentImages(image, config, async () => undefined)
        .catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: 'PROCESS_FAILURE', message: 'PROCESS_FAILURE' })
      expect(String((error as Error).message)).not.toContain(workRoot)
    } finally {
      await chmod(workRoot, 0o700)
    }
    expect(await readdir(workRoot)).toEqual([])
  })
})
