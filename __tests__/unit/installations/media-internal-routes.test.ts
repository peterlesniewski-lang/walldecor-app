import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installationMultipartBody } from '@/../__tests__/helpers/installation-multipart'

const INSTALLATION_MAX_FILE_BYTES = 10 * 1024 * 1024

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string; employeeId?: string | null } } | null,
  editable: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  softDelete: vi.fn(),
  mismatchUpload: vi.fn(),
  projectUpload: vi.fn(),
  adapter: { upload: vi.fn(), download: vi.fn(), remove: vi.fn() },
  Access: class InstallationMediaAccessError extends Error {},
  Validation: class InstallationMediaValidationError extends Error { fieldErrors = { file: 'bad' } },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/installations/room-route-access', () => ({ editableInstallationOrder: mocks.editable }))
vi.mock('@/lib/installation-media/client', () => ({ privateMediaClientFromEnvironment: () => mocks.adapter }))
vi.mock('@/lib/installation-media/service', () => ({
  listInstallationFiles: mocks.list,
  getInstallationFileForDownload: mocks.download,
  softDeleteInstallationFile: mocks.softDelete,
  createMismatchEvidenceFile: mocks.mismatchUpload,
  createInternalProjectFile: mocks.projectUpload,
  InstallationMediaAccessError: mocks.Access,
  InstallationMediaValidationError: mocks.Validation,
}))

import { GET as list, POST as mismatchUpload } from '@/app/api/installations/[id]/files/route'
import { DELETE as remove, GET as download } from '@/app/api/installations/[id]/files/[fileId]/route'

const params = { params: Promise.resolve({ id: 'order-1' }) }
const fileParams = { params: Promise.resolve({ id: 'order-1', fileId: 'file-1' }) }

describe('internal private-media routes', () => {
  beforeEach(() => {
    mocks.session = { user: { id: 'owner-user', role: 'EMPLOYEE', employeeId: 'owner-employee' } }
    mocks.editable.mockReset().mockResolvedValue({ order: { id: 'order-1' } })
    mocks.list.mockReset().mockResolvedValue([{ id: 'file-1', originalFilename: 'proof.png' }])
    mocks.download.mockReset().mockResolvedValue({ id: 'file-1', originalFilename: 'proof.png', contentType: 'image/png', byteSize: 3, sha256: 'a'.repeat(64) })
    mocks.softDelete.mockReset().mockResolvedValue({ id: 'file-1', remoteDeleteStatus: 'SUCCEEDED' })
    mocks.mismatchUpload.mockReset().mockResolvedValue({ id: 'file-evidence', status: 'READY' })
    mocks.projectUpload.mockReset().mockResolvedValue({ id: 'file-project', status: 'READY' })
    mocks.adapter.download.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }))
  })

  it('requires an authenticated active coordinator and never widens this route to installer access', async () => {
    mocks.session = null
    expect((await list(new NextRequest('http://test/api/installations/order-1/files'), params)).status).toBe(401)
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'installer-employee' } }
    mocks.editable.mockResolvedValue({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) })
    expect((await list(new NextRequest('http://test/api/installations/order-1/files'), params)).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists, streams and soft-deletes an authorized private file through the app proxy', async () => {
    const listed = await list(new NextRequest('http://test/api/installations/order-1/files'), params)
    expect(listed.status).toBe(200)
    expect(listed.headers.get('cache-control')).toBe('no-store')
    const streamed = await download(new NextRequest('http://test/api/installations/order-1/files/file-1'), fileParams)
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('content-disposition')).toContain('proof.png')
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(mocks.adapter.download).toHaveBeenCalledWith('file-1', { byteSize: 3, sha256: 'a'.repeat(64) })
    const deleted = await remove(new NextRequest('http://test/api/installations/order-1/files/file-1', { method: 'DELETE' }), fileParams)
    expect(deleted.status).toBe(200)
    expect(mocks.softDelete).toHaveBeenCalledWith({}, 'order-1', 'file-1', 'owner-user', mocks.adapter)
  })

  it('returns durable cleanup state and accepts a later retry for the same locally deleted file', async () => {
    mocks.softDelete
      .mockResolvedValueOnce({ id: 'file-1', remoteDeleteStatus: 'RETRY' })
      .mockResolvedValueOnce({ id: 'file-1', remoteDeleteStatus: 'SUCCEEDED' })

    const first = await remove(new NextRequest('http://test/api/installations/order-1/files/file-1', { method: 'DELETE' }), fileParams)
    expect(first.status).toBe(202)
    expect(await first.json()).toEqual({ ok: true, remoteDeleteStatus: 'RETRY' })
    const retry = await remove(new NextRequest('http://test/api/installations/order-1/files/file-1', { method: 'DELETE' }), fileParams)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ ok: true, remoteDeleteStatus: 'SUCCEEDED' })
    expect(mocks.softDelete).toHaveBeenCalledTimes(2)
  })

  it('accepts a private project file targeted to the order, room, or scope without exposing a media URL', async () => {
    const multipart = installationMultipartBody({ purpose: 'INTERNAL_PROJECT', roomId: 'room-1', scopeId: 'scope-1' }, {
      filename: 'rzut.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]),
    })
    const response = await mismatchUpload(new NextRequest('http://test/api/installations/order-1/files', {
      method: 'POST', headers: { 'Content-Type': multipart.contentType }, body: multipart.body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }), params)
    expect(response.status).toBe(201)
    expect(mocks.projectUpload).toHaveBeenCalledWith(expect.anything(), 'order-1', 'owner-user', expect.objectContaining({ roomId: 'room-1', scopeId: 'scope-1', filename: 'rzut.pdf', contentType: 'application/pdf' }), mocks.adapter)
    expect(JSON.stringify(await response.json())).not.toContain('private/v1')
  })

  it('stops a chunked internal upload at the hard limit before creating a database or media record', async () => {
    const multipart = installationMultipartBody({ purpose: 'INTERNAL_PROJECT' }, {
      filename: 'za-duzy.pdf', contentType: 'application/pdf', bytes: new Uint8Array(INSTALLATION_MAX_FILE_BYTES + 1024 * 1024),
    })
    const response = await mismatchUpload(new NextRequest('http://test/api/installations/order-1/files', {
      method: 'POST', headers: { 'Content-Type': multipart.contentType }, body: multipart.body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }), params)

    expect(response.status).toBe(413)
    expect(multipart.consumed()).toBeLessThanOrEqual(INSTALLATION_MAX_FILE_BYTES + 32 * 1024)
    expect(multipart.cancelled()).toBe(true)
    expect(mocks.projectUpload).not.toHaveBeenCalled()
    expect(mocks.mismatchUpload).not.toHaveBeenCalled()
    expect(mocks.adapter.upload).not.toHaveBeenCalled()
  })
})
