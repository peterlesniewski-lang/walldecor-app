import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { dirname, isAbsolute, parse, resolve } from 'node:path'
import { INVOICE_ATTACHMENT_MAX_BYTES } from './contracts'

export interface PrivateInvoiceAttachmentMetadata {
  key: string
  sha256: string
  byteSize: number
}

export interface InvoiceAttachmentIntegrity {
  sha256: string
  byteSize: number
}

export type PrivateInvoiceStoreErrorCode =
  | 'INVALID_ROOT'
  | 'INVALID_ATTACHMENT'
  | 'INVALID_KEY'
  | 'INVALID_INTEGRITY'
  | 'UNSAFE_PATH'
  | 'NOT_FOUND'
  | 'INTEGRITY_MISMATCH'
  | 'DESTINATION_EXISTS'
  | 'IO_FAILURE'

const ERROR_MESSAGES: Record<PrivateInvoiceStoreErrorCode, string> = {
  INVALID_ROOT: 'The private attachment root is invalid.',
  INVALID_ATTACHMENT: 'The attachment bytes are outside the accepted bounds.',
  INVALID_KEY: 'The private attachment key is invalid.',
  INVALID_INTEGRITY: 'The expected attachment integrity metadata is invalid.',
  UNSAFE_PATH: 'The private attachment path is unsafe.',
  NOT_FOUND: 'The private attachment was not found.',
  INTEGRITY_MISMATCH: 'The private attachment failed integrity verification.',
  DESTINATION_EXISTS: 'The generated private attachment key already exists.',
  IO_FAILURE: 'The private attachment operation failed.',
}

export class PrivateInvoiceStoreError extends Error {
  readonly code: PrivateInvoiceStoreErrorCode

  constructor(code: PrivateInvoiceStoreErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'PrivateInvoiceStoreError'
    this.code = code
  }
}

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const READ_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW
const STAGING_OPEN_FLAGS =
  constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

function storeError(
  error: unknown,
  fallback: PrivateInvoiceStoreErrorCode,
  missingIsNotFound = false,
): PrivateInvoiceStoreError {
  if (error instanceof PrivateInvoiceStoreError) return error
  if (missingIsNotFound && isErrno(error, 'ENOENT')) {
    return new PrivateInvoiceStoreError('NOT_FOUND')
  }
  if (isErrno(error, 'ELOOP')) return new PrivateInvoiceStoreError('UNSAFE_PATH')
  return new PrivateInvoiceStoreError(fallback)
}

function validateKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new PrivateInvoiceStoreError('INVALID_KEY')
}

function validateIntegrity(expected: InvoiceAttachmentIntegrity): void {
  if (
    !expected ||
    !SHA256_PATTERN.test(expected.sha256) ||
    !Number.isSafeInteger(expected.byteSize) ||
    expected.byteSize < 1 ||
    expected.byteSize > INVOICE_ATTACHMENT_MAX_BYTES
  ) {
    throw new PrivateInvoiceStoreError('INVALID_INTEGRITY')
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (!handle) return
  try {
    await handle.close()
  } catch {
    // The caller already has a safe operation error to report.
  }
}

async function unlinkQuietly(target: string): Promise<boolean> {
  try {
    await unlink(target)
    return true
  } catch {
    // Cleanup is best-effort and restricted to the exact random file we own.
    return false
  }
}

interface VerifiedOpenFile {
  bytes: Buffer
  handle: FileHandle
  info: Stats
}

/**
 * Stores original invoice bytes under an operator-supplied private directory.
 *
 * The operator must keep the parent filesystem local and trusted. Node does not
 * expose openat-style directory-relative operations, so an actor able to swap
 * path components concurrently remains outside this module's trust boundary.
 */
export class PrivateInvoiceAttachmentStore {
  private readonly root: string

  constructor(root: string) {
    if (typeof root !== 'string' || !isAbsolute(root)) {
      throw new PrivateInvoiceStoreError('INVALID_ROOT')
    }

    const normalizedRoot = resolve(root)
    if (normalizedRoot === parse(normalizedRoot).root) {
      throw new PrivateInvoiceStoreError('INVALID_ROOT')
    }
    this.root = normalizedRoot
  }

  async persist(bytes: Uint8Array): Promise<PrivateInvoiceAttachmentMetadata> {
    const isByteView = Buffer.isBuffer(bytes) || (ArrayBuffer.isView(bytes) && bytes.BYTES_PER_ELEMENT === 1)
    if (!isByteView || bytes.byteLength < 1 || bytes.byteLength > INVOICE_ATTACHMENT_MAX_BYTES) {
      throw new PrivateInvoiceStoreError('INVALID_ATTACHMENT')
    }

    const original = Buffer.from(bytes)
    const metadata: PrivateInvoiceAttachmentMetadata = {
      key: `${randomUUID()}.bin`,
      sha256: sha256(original),
      byteSize: original.byteLength,
    }
    const stagingPath = resolve(this.root, `.${randomUUID()}.stage`)
    const destinationPath = this.pathForKey(metadata.key)
    let stagingHandle: FileHandle | undefined
    let stagingCreated = false
    let published = false

    try {
      await this.ensurePrivateRoot()
      stagingHandle = await open(stagingPath, STAGING_OPEN_FLAGS, PRIVATE_FILE_MODE)
      stagingCreated = true
      await stagingHandle.chmod(PRIVATE_FILE_MODE)
      await stagingHandle.writeFile(original)
      await stagingHandle.sync()

      const stagedInfo = await stagingHandle.stat()
      if (
        !stagedInfo.isFile() ||
        stagedInfo.size !== metadata.byteSize ||
        (stagedInfo.mode & 0o777) !== PRIVATE_FILE_MODE
      ) {
        throw new PrivateInvoiceStoreError('IO_FAILURE')
      }

      await stagingHandle.close()
      stagingHandle = undefined

      try {
        await link(stagingPath, destinationPath)
      } catch (error) {
        if (isErrno(error, 'EEXIST')) {
          throw new PrivateInvoiceStoreError('DESTINATION_EXISTS')
        }
        throw error
      }
      published = true
      await this.syncPrivateRoot()

      await unlink(stagingPath)
      stagingCreated = false
      await this.syncPrivateRoot()
      return metadata
    } catch (error) {
      await closeQuietly(stagingHandle)
      stagingHandle = undefined
      let directoryChanged = false
      if (published) directoryChanged = (await unlinkQuietly(destinationPath)) || directoryChanged
      if (stagingCreated) directoryChanged = (await unlinkQuietly(stagingPath)) || directoryChanged
      if (directoryChanged) {
        try {
          await this.syncPrivateRoot()
        } catch {
          // Preserve the original failure while making the durability retry best-effort.
        }
      }
      throw storeError(error, 'IO_FAILURE')
    } finally {
      await closeQuietly(stagingHandle)
    }
  }

  async readVerified(key: string, expected: InvoiceAttachmentIntegrity): Promise<Buffer> {
    const verified = await this.openVerified(key, expected)
    try {
      return verified.bytes
    } finally {
      await closeQuietly(verified.handle)
    }
  }

  async removeExact(key: string, expected: InvoiceAttachmentIntegrity): Promise<void> {
    const verified = await this.openVerified(key, expected)
    const destinationPath = this.pathForKey(key)

    try {
      const current = await lstat(destinationPath)
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.size !== expected.byteSize ||
        !sameFile(current, verified.info)
      ) {
        throw new PrivateInvoiceStoreError('INTEGRITY_MISMATCH')
      }
      await unlink(destinationPath)
      await this.syncPrivateRoot()
    } catch (error) {
      throw storeError(error, 'IO_FAILURE', true)
    } finally {
      await closeQuietly(verified.handle)
    }
  }

  private pathForKey(key: string): string {
    validateKey(key)
    return resolve(this.root, key)
  }

  private async ensurePrivateRoot(): Promise<void> {
    const parent = dirname(this.root)
    let parentHandle: FileHandle | undefined
    let rootHandle: FileHandle | undefined

    try {
      const parentInfo = await lstat(parent)
      if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
        throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      }
      parentHandle = await open(parent, DIRECTORY_OPEN_FLAGS)
      const openedParentInfo = await parentHandle.stat()
      if (!openedParentInfo.isDirectory() || !sameFile(parentInfo, openedParentInfo)) {
        throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      }

      try {
        await mkdir(this.root, { mode: PRIVATE_DIRECTORY_MODE })
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
      }

      const rootInfo = await lstat(this.root)
      if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
        throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      }

      rootHandle = await open(this.root, DIRECTORY_OPEN_FLAGS)
      const openedInfo = await rootHandle.stat()
      if (!openedInfo.isDirectory() || !sameFile(rootInfo, openedInfo)) {
        throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      }

      await rootHandle.chmod(PRIVATE_DIRECTORY_MODE)
      const securedInfo = await rootHandle.stat()
      if ((securedInfo.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
        throw new PrivateInvoiceStoreError('IO_FAILURE')
      }
      await parentHandle.sync()
    } catch (error) {
      throw storeError(error, 'IO_FAILURE')
    } finally {
      await closeQuietly(rootHandle)
      await closeQuietly(parentHandle)
    }
  }

  private async syncPrivateRoot(): Promise<void> {
    let rootHandle: FileHandle | undefined

    try {
      rootHandle = await open(this.root, DIRECTORY_OPEN_FLAGS)
      const rootInfo = await rootHandle.stat()
      if (!rootInfo.isDirectory()) throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      await rootHandle.sync()
    } catch (error) {
      throw storeError(error, 'IO_FAILURE')
    } finally {
      await closeQuietly(rootHandle)
    }
  }

  private async openVerified(
    key: string,
    expected: InvoiceAttachmentIntegrity,
  ): Promise<VerifiedOpenFile> {
    validateKey(key)
    validateIntegrity(expected)
    await this.ensurePrivateRoot()

    const destinationPath = this.pathForKey(key)
    let handle: FileHandle | undefined

    try {
      const pathInfo = await lstat(destinationPath)
      if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
        throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      }
      if (pathInfo.size !== expected.byteSize) {
        throw new PrivateInvoiceStoreError('INTEGRITY_MISMATCH')
      }

      handle = await open(destinationPath, READ_OPEN_FLAGS)
      const openedInfo = await handle.stat()
      if (!openedInfo.isFile() || !sameFile(pathInfo, openedInfo)) {
        throw new PrivateInvoiceStoreError('UNSAFE_PATH')
      }
      if (openedInfo.size !== expected.byteSize) {
        throw new PrivateInvoiceStoreError('INTEGRITY_MISMATCH')
      }

      const original = await handle.readFile()
      const finalInfo = await handle.stat()
      if (
        !sameFile(openedInfo, finalInfo) ||
        finalInfo.size !== expected.byteSize ||
        original.byteLength !== expected.byteSize ||
        sha256(original) !== expected.sha256
      ) {
        throw new PrivateInvoiceStoreError('INTEGRITY_MISMATCH')
      }

      const verified = { bytes: original, handle, info: finalInfo }
      handle = undefined
      return verified
    } catch (error) {
      throw storeError(error, 'IO_FAILURE', true)
    } finally {
      await closeQuietly(handle)
    }
  }
}
