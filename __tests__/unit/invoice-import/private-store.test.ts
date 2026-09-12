import * as path from 'node:path'
import { randomUUID as actualRandomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faultState = vi.hoisted(() => ({
  failSyncPath: null as string | null,
  failNextStagingWrite: false,
  syncPaths: [] as string[],
  uuids: [] as string[],
}))

vi.mock('node:crypto', async () => {
  const { createRequire } = await import('node:module')
  const native = createRequire(import.meta.url)('node:crypto') as typeof import('node:crypto')
  const controlledRandomUUID = (...args: Parameters<typeof native.randomUUID>) => {
    const queued = faultState.uuids.shift()
    return queued ?? native.randomUUID(...args)
  }

  return {
    default: { ...native, randomUUID: controlledRandomUUID },
    createHash: native.createHash,
    randomUUID: controlledRandomUUID,
  }
})

vi.mock('node:fs/promises', async () => {
  const { createRequire } = await import('node:module')
  const native = createRequire(import.meta.url)('node:fs/promises') as typeof import('node:fs/promises')
  const controlledOpen = async (...args: Parameters<typeof native.open>) => {
    const handle = await native.open(...args)
    const openedPath = String(args[0])

    if (faultState.failNextStagingWrite && openedPath.endsWith('.stage')) {
      faultState.failNextStagingWrite = false
      const realWriteFile = handle.writeFile.bind(handle)
      handle.writeFile = async (data, options) => {
        const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
        await realWriteFile(bytes.subarray(0, 1), options)
        throw Object.assign(new Error('synthetic partial write failure'), { code: 'EIO' })
      }
    }

    const realSync = handle.sync.bind(handle)
    handle.sync = async () => {
      faultState.syncPaths.push(openedPath)
      if (faultState.failSyncPath === openedPath) {
        faultState.failSyncPath = null
        throw Object.assign(new Error('synthetic fsync failure'), { code: 'EIO' })
      }
      await realSync()
    }

    return handle
  }

  return {
    default: { ...native, open: controlledOpen },
    chmod: native.chmod,
    link: native.link,
    lstat: native.lstat,
    mkdir: native.mkdir,
    mkdtemp: native.mkdtemp,
    readFile: native.readFile,
    readdir: native.readdir,
    rm: native.rm,
    stat: native.stat,
    symlink: native.symlink,
    unlink: native.unlink,
    writeFile: native.writeFile,
    open: controlledOpen,
  }
})

import { INVOICE_ATTACHMENT_MAX_BYTES } from '@/lib/invoice-import/contracts'
import {
  PrivateInvoiceAttachmentStore,
  PrivateInvoiceStoreError,
  type InvoiceAttachmentIntegrity,
} from '@/lib/invoice-import/private-store'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/

async function expectStoreError(
  promise: Promise<unknown>,
  code: PrivateInvoiceStoreError['code'],
  hiddenPath?: string,
): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught)

  expect(error).toBeInstanceOf(PrivateInvoiceStoreError)
  expect(error).toMatchObject({ code })
  if (hiddenPath) expect((error as Error).message).not.toContain(hiddenPath)
}

describe('PrivateInvoiceAttachmentStore', () => {
  let sandbox: string
  let root: string

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'walldecor-invoice-private-store-'))
    root = path.join(sandbox, 'attachments')
    faultState.failSyncPath = null
    faultState.failNextStagingWrite = false
    faultState.syncPaths = []
    faultState.uuids = []
  })

  afterEach(async () => {
    faultState.failNextStagingWrite = false
    faultState.failSyncPath = null
    faultState.syncPaths = []
    faultState.uuids = []
    await rm(sandbox, { recursive: true, force: true })
  })

  it('keeps construction side-effect free and requires an absolute operator root', async () => {
    expect(() => new PrivateInvoiceAttachmentStore('relative/private')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ROOT' }),
    )

    new PrivateInvoiceAttachmentStore(root)

    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists exact bytes under opaque metadata and reconnects from a new instance', async () => {
    const original = Buffer.from([0, 255, 1, 80, 68, 70, 0, 13, 10])
    const stored = await new PrivateInvoiceAttachmentStore(root).persist(original)

    expect(stored).toEqual({
      key: expect.stringMatching(UUID_PATTERN),
      sha256: '12382437ea2fe3cb5007925037ea21d26e32badbda3efef66b982e1056c2b9d3',
      byteSize: original.byteLength,
    })
    expect(Object.keys(stored).sort()).toEqual(['byteSize', 'key', 'sha256'])

    const reconnected = new PrivateInvoiceAttachmentStore(root)
    await expect(reconnected.readVerified(stored.key, stored)).resolves.toEqual(original)
  })

  it('creates a 0700 root and publishes a 0600 regular file without staging leftovers', async () => {
    const stored = await new PrivateInvoiceAttachmentStore(root).persist(Buffer.from('private'))
    const rootInfo = await stat(root)
    const fileInfo = await stat(path.join(root, stored.key))

    expect(rootInfo.mode & 0o777).toBe(0o700)
    expect(fileInfo.mode & 0o777).toBe(0o600)
    expect(fileInfo.isFile()).toBe(true)
    expect(await readdir(root)).toEqual([stored.key])
    expect(faultState.syncPaths).toHaveLength(4)
    expect(faultState.syncPaths[0]).toBe(sandbox)
    expect(path.dirname(faultState.syncPaths[1])).toBe(root)
    expect(path.basename(faultState.syncPaths[1])).toMatch(/^\.[0-9a-f-]+\.stage$/)
    expect(faultState.syncPaths.slice(2)).toEqual([root, root])
  })

  it('repairs an existing private root to mode 0700 before use', async () => {
    await mkdir(root, { mode: 0o755 })
    await chmod(root, 0o755)

    await new PrivateInvoiceAttachmentStore(root).persist(Buffer.from('private'))

    expect((await stat(root)).mode & 0o777).toBe(0o700)
  })

  it.each([
    '',
    '../outside.bin',
    'nested/file.bin',
    '00000000-0000-4000-8000-000000000000',
    '00000000-0000-4000-8000-000000000000.pdf',
    '00000000-0000-1000-8000-000000000000.bin',
    '00000000-0000-4000-7000-000000000000.bin',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.bin',
  ])('rejects an invalid opaque key without touching the filesystem: %s', async (key) => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const expected: InvoiceAttachmentIntegrity = { sha256: '0'.repeat(64), byteSize: 1 }

    await expectStoreError(store.readVerified(key, expected), 'INVALID_KEY')
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects empty and oversized attachments before creating the root', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)

    await expectStoreError(store.persist(Buffer.alloc(0)), 'INVALID_ATTACHMENT')
    await expectStoreError(
      store.persist(Buffer.alloc(INVOICE_ATTACHMENT_MAX_BYTES + 1)),
      'INVALID_ATTACHMENT',
    )
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symbolic-link root without writing through it', async () => {
    const outside = path.join(sandbox, 'outside')
    await mkdir(outside)
    await symlink(outside, root, 'dir')

    await expectStoreError(
      new PrivateInvoiceAttachmentStore(root).persist(Buffer.from('blocked')),
      'UNSAFE_PATH',
      root,
    )
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects an immediate symbolic-link parent without creating the private root', async () => {
    const outside = path.join(sandbox, 'outside-parent')
    const linkedParent = path.join(sandbox, 'linked-parent')
    await mkdir(outside)
    await symlink(outside, linkedParent, 'dir')

    const linkedRoot = path.join(linkedParent, 'attachments')
    await expectStoreError(
      new PrivateInvoiceAttachmentStore(linkedRoot).persist(Buffer.from('blocked')),
      'UNSAFE_PATH',
      linkedRoot,
    )
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects a symbolic-link attachment even when its target has the expected bytes', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const stored = await store.persist(Buffer.from('original'))
    const externalFile = path.join(sandbox, 'external.bin')
    await writeFile(externalFile, Buffer.from('original'))
    await unlink(path.join(root, stored.key))
    await symlink(externalFile, path.join(root, stored.key), 'file')

    await expectStoreError(store.readVerified(stored.key, stored), 'UNSAFE_PATH', root)
  })

  it('rejects a size-tampered regular file without returning bytes', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const stored = await store.persist(Buffer.from('original'))
    await writeFile(path.join(root, stored.key), Buffer.from('longer-tampered'))

    await expectStoreError(store.readVerified(stored.key, stored), 'INTEGRITY_MISMATCH', root)
  })

  it('rejects a same-size hash-tampered regular file without returning bytes', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const stored = await store.persist(Buffer.from('original'))
    await writeFile(path.join(root, stored.key), Buffer.from('tampered'))

    await expectStoreError(store.readVerified(stored.key, stored), 'INTEGRITY_MISMATCH', root)
  })

  it('rejects malformed expected integrity metadata before filesystem access', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const key = `${actualRandomUUID()}.bin`

    await expectStoreError(
      store.readVerified(key, { sha256: '../not-a-hash', byteSize: 1 }),
      'INVALID_INTEGRITY',
    )
    await expectStoreError(
      store.readVerified(key, { sha256: '0'.repeat(64), byteSize: 0 }),
      'INVALID_INTEGRITY',
    )
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never overwrites an existing destination when an opaque-key collision occurs', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const existing = await store.persist(Buffer.from('first bytes'))
    const existingUuid = existing.key.slice(0, -'.bin'.length)
    faultState.uuids = [existingUuid, actualRandomUUID()]

    await expectStoreError(store.persist(Buffer.from('second bytes')), 'DESTINATION_EXISTS', root)

    expect(await readFile(path.join(root, existing.key))).toEqual(Buffer.from('first bytes'))
    expect(await readdir(root)).toEqual([existing.key])
  })

  it('closes and removes its own staging file after a partial write failure', async () => {
    faultState.failNextStagingWrite = true
    const store = new PrivateInvoiceAttachmentStore(root)

    await expectStoreError(store.persist(Buffer.from('write must fail')), 'IO_FAILURE', root)

    expect(await readdir(root)).toEqual([])
  })

  it('fails closed and syncs compensation after a directory fsync failure', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const neighbour = await store.persist(Buffer.from('existing neighbour'))
    faultState.syncPaths = []
    faultState.failSyncPath = root

    await expectStoreError(store.persist(Buffer.from('must not publish')), 'IO_FAILURE', root)

    expect(faultState.failSyncPath).toBeNull()
    expect(faultState.syncPaths.at(-2)).toBe(root)
    expect(faultState.syncPaths.at(-1)).toBe(root)
    expect(await readdir(root)).toEqual([neighbour.key])
    await expect(store.readVerified(neighbour.key, neighbour)).resolves.toEqual(
      Buffer.from('existing neighbour'),
    )
  })

  it('fails closed when the parent fsync fails and retries it after the root already exists', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    faultState.failSyncPath = sandbox

    await expectStoreError(store.persist(Buffer.from('first attempt')), 'IO_FAILURE', root)

    expect(faultState.syncPaths).toEqual([sandbox])
    expect(await readdir(root)).toEqual([])

    const neighbourPath = path.join(root, 'operator-neighbour')
    await writeFile(neighbourPath, Buffer.from('keep me'), { mode: 0o600 })
    faultState.syncPaths = []
    faultState.failSyncPath = sandbox

    await expectStoreError(store.persist(Buffer.from('second attempt')), 'IO_FAILURE', root)

    expect(faultState.syncPaths).toEqual([sandbox])
    expect(await readdir(root)).toEqual(['operator-neighbour'])

    faultState.syncPaths = []
    const stored = await store.persist(Buffer.from('retry succeeds'))

    expect(faultState.syncPaths[0]).toBe(sandbox)
    expect((await readdir(root)).sort()).toEqual([stored.key, 'operator-neighbour'].sort())
    expect(await readFile(neighbourPath)).toEqual(Buffer.from('keep me'))
  })

  it('removeExact refuses mismatched integrity and removes only the exact validated target', async () => {
    const store = new PrivateInvoiceAttachmentStore(root)
    const target = await store.persist(Buffer.from('target bytes'))
    const neighbour = await store.persist(Buffer.from('neighbour bytes'))

    await expectStoreError(
      store.removeExact(target.key, { ...target, sha256: neighbour.sha256 }),
      'INTEGRITY_MISMATCH',
      root,
    )
    await expect(readFile(path.join(root, target.key))).resolves.toEqual(Buffer.from('target bytes'))

    faultState.syncPaths = []
    await store.removeExact(target.key, target)

    await expect(lstat(path.join(root, target.key))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(faultState.syncPaths).toEqual([sandbox, root])
    await expect(store.readVerified(neighbour.key, neighbour)).resolves.toEqual(
      Buffer.from('neighbour bytes'),
    )
    expect(await readdir(root)).toEqual([neighbour.key])
  })
})
