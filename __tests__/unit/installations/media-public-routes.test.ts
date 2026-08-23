import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  handoff: vi.fn(),
  redeem: vi.fn(),
  mobileUpload: vi.fn(),
  revoke: vi.fn(),
  adapter: { upload: vi.fn(), download: vi.fn(), remove: vi.fn() },
  Access: class InstallationMediaAccessError extends Error {},
  Validation: class InstallationMediaValidationError extends Error { fieldErrors = { file: 'bad' } },
}))

vi.mock('@/lib/installation-media/service', () => ({
  listClientQuestionFiles: mocks.list,
  createClientQuestionFile: mocks.upload,
  createMobileUploadHandoff: mocks.handoff,
  redeemMobileUploadHandoff: mocks.redeem,
  uploadMobileHandoffFile: mocks.mobileUpload,
  revokeMobileUploadHandoff: mocks.revoke,
  InstallationMediaAccessError: mocks.Access,
  InstallationMediaValidationError: mocks.Validation,
}))
vi.mock('@/lib/installation-media/client', () => ({ privateMediaClientFromEnvironment: () => mocks.adapter }))

import { GET as list, POST as upload } from '@/app/api/public/installations/[token]/files/route'
import { POST as createHandoff } from '@/app/api/public/installations/[token]/handoffs/route'
import { POST as redeem } from '@/app/api/public/mobile-upload/[code]/redeem/route'
import { POST as mobileUpload } from '@/app/api/public/mobile-upload/session/files/route'

const params = { params: Promise.resolve({ token: 'a'.repeat(43) }) }
const codeParams = { params: Promise.resolve({ code: 'b'.repeat(43) }) }

describe('public private-media routes', () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue([{ id: 'file-1', originalFilename: 'sciana.png' }])
    mocks.upload.mockReset().mockResolvedValue({ id: 'file-1', status: 'READY', originalFilename: 'sciana.png' })
    mocks.handoff.mockReset().mockResolvedValue({ handoffId: 'handoff-1', code: 'b'.repeat(43), expiresAt: new Date('2027-01-01') })
    mocks.redeem.mockReset().mockResolvedValue({ handoffId: 'handoff-1', cookieValue: `handoff-1.${'c'.repeat(43)}`, expiresAt: new Date('2027-01-01'), questionKey: 'zdjecie' })
    mocks.mobileUpload.mockReset().mockResolvedValue({ id: 'file-mobile', status: 'READY', originalFilename: 'aparat.png' })
    mocks.revoke.mockReset().mockResolvedValue(undefined)
    vi.spyOn(NextRequest.prototype, 'formData').mockResolvedValue({
      get: (key: string) => key === 'questionKey' ? 'zdjecie' : { name: 'sciana.png', type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
    } as never)
  })

  it('lists and uploads only one question-scoped public file with no-store responses', async () => {
    const listed = await list(new NextRequest('http://test/api/public/installations/token/files?questionKey=zdjecie'), params)
    expect(listed.status).toBe(200)
    expect(listed.headers.get('cache-control')).toBe('no-store')
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(43), 'zdjecie')

    const uploaded = await upload(new NextRequest('http://test/api/public/installations/token/files', { method: 'POST' }), params)
    expect(uploaded.status).toBe(201)
    expect(uploaded.headers.get('cache-control')).toBe('no-store')
    expect(mocks.upload).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(43), expect.objectContaining({ questionKey: 'zdjecie', filename: 'sciana.png', contentType: 'image/png' }), mocks.adapter)
  })

  it('returns the deliberately identical no-store 404 for an inaccessible public file target', async () => {
    mocks.list.mockRejectedValueOnce(new mocks.Access())
    const response = await list(new NextRequest('http://test/api/public/installations/token/files?questionKey=other'), params)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Nie znaleziono strony.' })
  })

  it('creates a question-specific QR handoff but never exposes a media-service URL', async () => {
    const response = await createHandoff(new NextRequest('http://app.example.test/api/public/installations/token/handoffs', {
      method: 'POST', body: JSON.stringify({ questionKey: 'zdjecie' }), headers: { 'Content-Type': 'application/json' },
    }), params)
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.handoffUrl).toBe(`http://app.example.test/m/u/${'b'.repeat(43)}`)
    expect(body.qrSvg).toContain('<svg')
    expect(JSON.stringify(body)).not.toContain('private/v1')
  })

  it('burns the code into a secure HttpOnly Lax cookie and only lets that mobile session add bytes', async () => {
    const redeemed = await redeem(new NextRequest('https://app.example.test/api/public/mobile-upload/code/redeem', { method: 'POST' }), codeParams)
    expect(redeemed.status).toBe(200)
    expect(redeemed.headers.get('set-cookie')).toContain('HttpOnly')
    expect(redeemed.headers.get('set-cookie')).toContain('Secure')
    expect(redeemed.headers.get('set-cookie')).toMatch(/SameSite=lax/i)
    expect(mocks.redeem).toHaveBeenCalledWith(expect.anything(), 'b'.repeat(43))

    const uploaded = await mobileUpload(new NextRequest('https://app.example.test/api/public/mobile-upload/session/files', {
      method: 'POST', headers: { cookie: `installation_mobile_upload=handoff-1.${'c'.repeat(43)}` },
    }))
    expect(uploaded.status).toBe(201)
    expect(mocks.mobileUpload).toHaveBeenCalledWith(expect.anything(), `handoff-1.${'c'.repeat(43)}`, expect.objectContaining({ filename: 'sciana.png' }), mocks.adapter)
  })
})
