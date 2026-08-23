import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    mocks.download.mockReset().mockResolvedValue({ id: 'file-1', originalFilename: 'proof.png', contentType: 'image/png' })
    mocks.softDelete.mockReset().mockResolvedValue({ id: 'file-1' })
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
    expect(mocks.adapter.download).toHaveBeenCalledWith('file-1')
    const deleted = await remove(new NextRequest('http://test/api/installations/order-1/files/file-1', { method: 'DELETE' }), fileParams)
    expect(deleted.status).toBe(200)
    expect(mocks.softDelete).toHaveBeenCalledWith({}, 'order-1', 'file-1', 'owner-user', mocks.adapter)
  })

  it('accepts a private project file targeted to the order, room, or scope without exposing a media URL', async () => {
    vi.spyOn(NextRequest.prototype, 'formData').mockResolvedValue({
      get: (key: string) => key === 'purpose' ? 'INTERNAL_PROJECT' : key === 'roomId' ? 'room-1' : key === 'scopeId' ? 'scope-1' : key === 'file' ? { name: 'rzut.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : null,
    } as never)
    const response = await mismatchUpload(new NextRequest('http://test/api/installations/order-1/files', { method: 'POST' }), params)
    expect(response.status).toBe(201)
    expect(mocks.projectUpload).toHaveBeenCalledWith(expect.anything(), 'order-1', 'owner-user', expect.objectContaining({ roomId: 'room-1', scopeId: 'scope-1', filename: 'rzut.pdf', contentType: 'application/pdf' }), mocks.adapter)
    expect(JSON.stringify(await response.json())).not.toContain('private/v1')
  })
})
