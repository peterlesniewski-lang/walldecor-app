// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInvoiceFileEnvironment } from '@/lib/invoice-import/files-runtime'

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(await realpath(tmpdir()), 'invoice-runtime-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const configuration = () => ({
  INVOICE_ORIGINALS_DIR: path.join(directory, 'originals'),
  INVOICE_PROCESSING_DIR: path.join(directory, 'processing'),
})

describe('operator-only private invoice runtime', () => {
  it('fails closed for missing, relative, broad or overlapping directories', async () => {
    for (const env of [
      {}, { ...configuration(), INVOICE_ORIGINALS_DIR: 'public/invoices' },
      { ...configuration(), INVOICE_ORIGINALS_DIR: '/' },
      { ...configuration(), INVOICE_PROCESSING_DIR: configuration().INVOICE_ORIGINALS_DIR },
      { ...configuration(), INVOICE_PROCESSING_DIR: path.join(configuration().INVOICE_ORIGINALS_DIR, 'tmp') },
      { ...configuration(), INVOICE_ORIGINALS_DIR: path.join(process.cwd(), 'public', 'invoices') },
      { ...configuration(), INVOICE_PDFINFO_BINARY: 'pdfinfo' },
    ]) {
      await expect(createInvoiceFileEnvironment(env)).rejects.toMatchObject({ code: 'UPLOAD_NOT_CONFIGURED', status: 503 })
    }
  })

  it('creates a private processing directory and stores originals with the existing verified store', async () => {
    const files = await createInvoiceFileEnvironment(configuration())
    expect(files.processor).toMatchObject({ workRoot: configuration().INVOICE_PROCESSING_DIR, pdfInfoBinary: '/usr/bin/pdfinfo', pdfToPpmBinary: '/usr/bin/pdftoppm' })
    expect((await stat(files.processor.workRoot)).mode & 0o777).toBe(0o700)
    const original = Buffer.from('private original bytes')
    const saved = await files.store.persist(original)
    expect(await files.store.readVerified(saved.key, saved)).toEqual(original)
    expect((await stat(configuration().INVOICE_ORIGINALS_DIR)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(configuration().INVOICE_ORIGINALS_DIR, saved.key))).mode & 0o777).toBe(0o600)
    const second = await createInvoiceFileEnvironment(configuration())
    expect(await second.store.readVerified(saved.key, saved)).toEqual(original)
  })

  it('rejects unsafe existing processing paths without changing their permissions or contents', async () => {
    await mkdir(configuration().INVOICE_PROCESSING_DIR, { mode: 0o755 })
    const sentinel = path.join(configuration().INVOICE_PROCESSING_DIR, 'keep')
    await writeFile(sentinel, 'untouched')
    await expect(createInvoiceFileEnvironment(configuration())).rejects.toMatchObject({ code: 'UPLOAD_NOT_CONFIGURED' })
    expect((await stat(configuration().INVOICE_PROCESSING_DIR)).mode & 0o777).toBe(0o755)
    expect(await readFile(sentinel, 'utf8')).toBe('untouched')
  })

  it('rejects symlink roots and symlinked parents before writing files', async () => {
    const target = path.join(directory, 'target')
    await mkdir(target, { mode: 0o700 })
    await symlink(target, configuration().INVOICE_PROCESSING_DIR)
    await expect(createInvoiceFileEnvironment(configuration())).rejects.toMatchObject({ code: 'UPLOAD_NOT_CONFIGURED' })
    await expect(createInvoiceFileEnvironment({ ...configuration(), INVOICE_PROCESSING_DIR: path.join(configuration().INVOICE_PROCESSING_DIR, 'child') })).rejects.toMatchObject({ code: 'UPLOAD_NOT_CONFIGURED' })
    await expect(createInvoiceFileEnvironment({ ...configuration(), INVOICE_ORIGINALS_DIR: configuration().INVOICE_PROCESSING_DIR, INVOICE_PROCESSING_DIR: path.join(directory, 'safe') })).rejects.toMatchObject({ code: 'UPLOAD_NOT_CONFIGURED' })
  })
})
