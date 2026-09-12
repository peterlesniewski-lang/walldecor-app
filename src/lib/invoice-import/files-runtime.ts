import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, parse, resolve, sep } from 'node:path'
import type { InvoiceFileEnvironment } from './file-service'
import { PrivateInvoiceAttachmentStore } from './private-store'

export class InvoiceFilesConfigurationError extends Error {
  readonly code = 'UPLOAD_NOT_CONFIGURED'
  readonly status = 503
  constructor() { super('Private invoice storage is not configured safely.') }
}

function absolute(value: string | undefined): string {
  if (!value || !isAbsolute(value) || value.includes('\0')) throw new InvoiceFilesConfigurationError()
  const result = resolve(value)
  if (result === parse(result).root) throw new InvoiceFilesConfigurationError()
  return result
}

function contains(parent: string, child: string) {
  return parent === child || child.startsWith(`${parent}${sep}`)
}

async function checkDirectory(directory: string, mayBeMissing: boolean) {
  // The configured parent must already exist on a trusted, local filesystem.
  // Requiring its canonical path also rejects symlinks in earlier components.
  const parent = dirname(directory)
  const parentInfo = await lstat(parent)
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new InvoiceFilesConfigurationError()
  }
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) {
      throw new InvoiceFilesConfigurationError()
    }
  } catch (error) {
    if (mayBeMissing && error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

/** Lazy, operator-only configuration: no directory access during route import
 * or an unauthenticated request. Never fall back to cwd or a public directory. */
export async function createInvoiceFileEnvironment(
  env: Record<string, string | undefined> = process.env,
): Promise<InvoiceFileEnvironment> {
  try {
    const originals = absolute(env.INVOICE_ORIGINALS_DIR)
    const processing = absolute(env.INVOICE_PROCESSING_DIR)
    const publicDirectory = resolve(process.cwd(), 'public')
    if (contains(originals, processing) || contains(processing, originals)
      || [originals, processing].some((directory) => contains(publicDirectory, directory) || contains(directory, publicDirectory))) {
      throw new InvoiceFilesConfigurationError()
    }
    const pdfInfoBinary = absolute(env.INVOICE_PDFINFO_BINARY ?? '/usr/bin/pdfinfo')
    const pdfToPpmBinary = absolute(env.INVOICE_PDFTOPPM_BINARY ?? '/usr/bin/pdftoppm')
    await checkDirectory(originals, true)
    await checkDirectory(processing, true)
    try { await mkdir(processing, { mode: 0o700 }) }
    catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await checkDirectory(processing, false)
    return {
      store: new PrivateInvoiceAttachmentStore(originals),
      processor: { workRoot: processing, pdfInfoBinary, pdfToPpmBinary },
    }
  } catch {
    // Operator paths and native filesystem errors never reach the browser.
    throw new InvoiceFilesConfigurationError()
  }
}
