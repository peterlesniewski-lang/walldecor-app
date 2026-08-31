import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installationMultipartBody } from '@/../__tests__/helpers/installation-multipart'

const INSTALLATION_MAX_FILE_BYTES = 10 * 1024 * 1024

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
    vi.unstubAllEnvs()
    mocks.list.mockReset().mockResolvedValue([{ id: 'file-1', originalFilename: 'sciana.png' }])
    mocks.upload.mockReset().mockResolvedValue({
      id: 'file-1', status: 'READY', originalFilename: 'sciana.png', contentType: 'image/png', byteSize: 3,
      sha256: 'a'.repeat(64), createdAt: new Date('2026-08-23T12:00:00.000Z'), orderId: 'secret-order', formSubmissionId: 'secret-submission', clientLinkId: 'secret-link',
    })
    mocks.handoff.mockReset().mockResolvedValue({ handoffId: 'handoff-1', code: 'b'.repeat(43), expiresAt: new Date('2027-01-01') })
    mocks.redeem.mockReset().mockResolvedValue({ handoffId: 'handoff-1', cookieValue: `handoff-1.${'c'.repeat(43)}`, expiresAt: new Date('2027-01-01'), questionKey: 'zdjecie' })
    mocks.mobileUpload.mockReset().mockResolvedValue({
      id: 'file-mobile', status: 'READY', originalFilename: 'aparat.png', contentType: 'image/png', byteSize: 3,
      sha256: 'b'.repeat(64), createdAt: new Date('2026-08-23T12:00:00.000Z'), orderId: 'secret-order', mobileHandoffId: 'secret-handoff', createdById: 'PUBLIC_MOBILE',
    })
    mocks.revoke.mockReset().mockResolvedValue(undefined)
  })

  it('lists and uploads only one question-scoped public file with no-store responses', async () => {
    const listed = await list(new NextRequest('http://test/api/public/installations/token/files?questionKey=zdjecie'), params)
    expect(listed.status).toBe(200)
    expect(listed.headers.get('cache-control')).toBe('no-store')
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(43), 'zdjecie')

    const multipart = installationMultipartBody({ questionKey: 'zdjecie' }, { filename: 'sciana.png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    const uploaded = await upload(new NextRequest('http://test/api/public/installations/token/files', {
      method: 'POST', headers: { 'Content-Type': multipart.contentType }, body: multipart.body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }), params)
    expect(uploaded.status).toBe(201)
    expect(uploaded.headers.get('cache-control')).toBe('no-store')
    expect(mocks.upload).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(43), expect.objectContaining({ questionKey: 'zdjecie', filename: 'sciana.png', contentType: 'image/png' }), mocks.adapter)
    expect(await uploaded.json()).toEqual({ file: {
      id: 'file-1', originalFilename: 'sciana.png', contentType: 'image/png', byteSize: 3,
      sha256: 'a'.repeat(64), createdAt: '2026-08-23T12:00:00.000Z',
    } })
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

  it('uses the configured public app origin for a QR handoff behind the production proxy', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', 'https://app.walldecor.pl')

    const response = await createHandoff(new NextRequest('https://0.0.0.0:3000/api/public/installations/token/handoffs', {
      method: 'POST', body: JSON.stringify({ questionKey: 'zdjecie' }), headers: { 'Content-Type': 'application/json' },
    }), params)

    expect(response.status).toBe(201)
    expect((await response.json()).handoffUrl).toBe(`https://app.walldecor.pl/m/u/${'b'.repeat(43)}`)
  })

  it('burns the code into a secure HttpOnly Lax cookie and only lets that mobile session add bytes', async () => {
    const redeemed = await redeem(new NextRequest('https://app.example.test/api/public/mobile-upload/code/redeem', { method: 'POST' }), codeParams)
    expect(redeemed.status).toBe(200)
    expect(redeemed.headers.get('set-cookie')).toContain('HttpOnly')
    expect(redeemed.headers.get('set-cookie')).toContain('Secure')
    expect(redeemed.headers.get('set-cookie')).toMatch(/SameSite=lax/i)
    expect(mocks.redeem).toHaveBeenCalledWith(expect.anything(), 'b'.repeat(43))

    const multipart = installationMultipartBody({}, { filename: 'sciana.png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    const uploaded = await mobileUpload(new NextRequest('https://app.example.test/api/public/mobile-upload/session/files', {
      method: 'POST', headers: { cookie: `installation_mobile_upload=handoff-1.${'c'.repeat(43)}`, 'Content-Type': multipart.contentType }, body: multipart.body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }))
    expect(uploaded.status).toBe(201)
    expect(mocks.mobileUpload).toHaveBeenCalledWith(expect.anything(), `handoff-1.${'c'.repeat(43)}`, expect.objectContaining({ filename: 'sciana.png' }), mocks.adapter)
    expect(await uploaded.json()).toEqual({ file: {
      id: 'file-mobile', originalFilename: 'aparat.png', contentType: 'image/png', byteSize: 3,
      sha256: 'b'.repeat(64), createdAt: '2026-08-23T12:00:00.000Z',
    } })
  })

  it('stops chunked desktop and mobile uploads at the shared hard limit before calling a service', async () => {
    const desktopBody = installationMultipartBody({ questionKey: 'zdjecie' }, {
      filename: 'za-duzy.png', contentType: 'image/png', bytes: new Uint8Array(INSTALLATION_MAX_FILE_BYTES + 1024 * 1024),
    })
    const desktop = await upload(new NextRequest('http://test/api/public/installations/token/files', {
      method: 'POST', headers: { 'Content-Type': desktopBody.contentType }, body: desktopBody.body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }), params)
    expect(desktop.status).toBe(413)
    expect(desktopBody.consumed()).toBeLessThanOrEqual(INSTALLATION_MAX_FILE_BYTES + 32 * 1024)
    expect(desktopBody.cancelled()).toBe(true)
    expect(mocks.upload).not.toHaveBeenCalled()

    const mobileBody = installationMultipartBody({}, {
      filename: 'za-duzy-mobile.png', contentType: 'image/png', bytes: new Uint8Array(INSTALLATION_MAX_FILE_BYTES + 1024 * 1024),
    })
    const mobile = await mobileUpload(new NextRequest('https://app.example.test/api/public/mobile-upload/session/files', {
      method: 'POST', headers: { cookie: `installation_mobile_upload=handoff-1.${'c'.repeat(43)}`, 'Content-Type': mobileBody.contentType }, body: mobileBody.body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }))
    expect(mobile.status).toBe(413)
    expect(mobileBody.consumed()).toBeLessThanOrEqual(INSTALLATION_MAX_FILE_BYTES + 32 * 1024)
    expect(mobileBody.cancelled()).toBe(true)
    expect(mocks.mobileUpload).not.toHaveBeenCalled()
  })
})
