import { createHash, webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvoiceOriginalPreview } from '@/components/invoice-import/invoice-original-preview'

const bytes = new Uint8Array([1, 2, 3, 4])
const attachment = { originalName: 'Oryginał.png', sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.byteLength, mimeType: 'image/png', pageCount: null }
const createUrl = vi.fn<(blob: Blob) => string>(() => 'blob:private-invoice')
const revokeUrl = vi.fn()

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) } })))
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('private original preview', () => {
  it('loads only a verified blob, retains private download links and releases its object URL', async () => {
    const view = render(<InvoiceOriginalPreview draftId="draft-one" attachment={attachment} />)
    expect(screen.getByText('Wczytuję oryginał…')).toBeTruthy()
    expect((await screen.findByAltText('Oryginał.png')).getAttribute('src')).toBe('blob:private-invoice')
    expect(screen.getByRole('link', { name: 'Pobierz oryginał' }).getAttribute('href')).toBe('/api/finance/invoice-import/drafts/draft-one/file?download=1')
    view.unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:private-invoice')
  })

  it('shows a readable integrity error without rendering unverified bytes and allows retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('bad', { status: 500 }))
    render(<InvoiceOriginalPreview draftId="draft-one" attachment={attachment} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Nie można zweryfikować oryginału')
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ponów podgląd' }))
    expect(await screen.findByAltText('Oryginał.png')).toBeTruthy()
  })

  it('does not create a preview after unmount while a request is pending', async () => {
    let resolve!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const view = render(<InvoiceOriginalPreview draftId="draft-one" attachment={attachment} />)
    view.unmount()
    await act(async () => { resolve(new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) } })) })
    await waitFor(() => expect(createUrl).not.toHaveBeenCalled())
  })

  it('never shows the previous document when selection changes during a pending request', async () => {
    let finishFirst!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
    const view = render(<InvoiceOriginalPreview draftId="old-draft" attachment={attachment} />)
    const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal
    view.rerender(<InvoiceOriginalPreview draftId="new-draft" attachment={{ ...attachment, originalName: 'Nowy.png' }} />)
    expect(firstSignal?.aborted).toBe(true)
    expect(await screen.findByAltText('Nowy.png')).toBeTruthy()
    await act(async () => finishFirst(new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': '4' } })))
    expect(screen.queryByAltText('Oryginał.png')).toBeNull()
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Pobierz oryginał' }).getAttribute('href')).toContain('/new-draft/file?download=1')
  })

  it('uses a verified private PDF blob as the frame source', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-length': '4' } }))
    const view = render(<InvoiceOriginalPreview draftId="pdf-draft" attachment={{ ...attachment, mimeType: 'application/pdf', originalName: 'Faktura.pdf', pageCount: 2 }} />)
    const frame = await screen.findByTitle('Oryginał: Faktura.pdf')
    expect(frame.getAttribute('src')).toBe('blob:private-invoice')
    expect(createUrl.mock.calls[0][0]).toMatchObject({ type: 'application/pdf' })
    view.unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:private-invoice')
  })

  it('releases the object URL immediately if the browser cannot decode the image', async () => {
    render(<InvoiceOriginalPreview draftId="draft-one" attachment={attachment} />)
    fireEvent.error(await screen.findByAltText('Oryginał.png'))
    expect(screen.getByRole('alert').textContent).toContain('Nie można wyświetlić oryginału')
    expect(revokeUrl).toHaveBeenCalledWith('blob:private-invoice')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
