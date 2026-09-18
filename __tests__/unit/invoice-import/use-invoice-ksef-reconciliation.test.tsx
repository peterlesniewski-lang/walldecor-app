import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useInvoiceKsefReconciliation } from '@/components/invoice-import/use-invoice-ksef-reconciliation'
import type { InvoiceDraftKsefReconciliation } from '@/lib/invoice-import/client-contracts'

const draft = (id = 'a', version = 1, count = 1) => ({ id, version, state: 'OPEN' as const, ksef: { linkedCount: count, conflictCount: 0 } })
const data = (id = 'a', version = 1): InvoiceDraftKsefReconciliation => ({ draftId: id, draftVersion: version, draftState: 'OPEN', links: [] })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no }), resolve, reject }
}

describe('current KSeF comparison reads', () => {
  it('uses the server zero-link summary without another request and never blocks an unlinked invoice', () => {
    const client = { ksef: vi.fn() }
    const { result } = renderHook(() => useInvoiceKsefReconciliation(draft('a', 1, 0), client))
    expect(result.current).toMatchObject({ reconciliation: data(), loading: false, error: null, approvalBlockReason: null })
    expect(client.ksef).not.toHaveBeenCalled()
  })

  it('blocks approval during loading and until an explicit failed-read retry completes', async () => {
    const first = deferred<InvoiceDraftKsefReconciliation>()
    const retry = deferred<InvoiceDraftKsefReconciliation>()
    const client = { ksef: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise) }
    const { result } = renderHook(() => useInvoiceKsefReconciliation(draft(), client))
    expect(result.current.loading).toBe(true)
    expect(result.current.approvalBlockReason).toBeTruthy()
    await act(async () => { first.reject(new Error('Nie można wczytać porównania.')) })
    expect(result.current).toMatchObject({ loading: false, error: 'Nie można wczytać porównania.' })
    expect(result.current.approvalBlockReason).toBeTruthy()
    act(() => result.current.refresh())
    expect(result.current.loading).toBe(true)
    await act(async () => { retry.resolve(data()) })
    expect(result.current).toMatchObject({ loading: false, error: null, approvalBlockReason: null, reconciliation: data() })
    expect(client.ksef).toHaveBeenCalledTimes(2)
  })

  it('cancels the old document request and ignores its late failure after switching', async () => {
    const old = deferred<InvoiceDraftKsefReconciliation>()
    const client = { ksef: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(data('b')) }
    const { result, rerender } = renderHook(({ current }) => useInvoiceKsefReconciliation(current, client), { initialProps: { current: draft() } })
    const oldSignal = client.ksef.mock.calls[0][1] as AbortSignal
    rerender({ current: draft('b') })
    await waitFor(() => expect(result.current.reconciliation?.draftId).toBe('b'))
    expect(oldSignal.aborted).toBe(true)
    await act(async () => old.reject(new Error('Błąd poprzedniego dokumentu')))
    expect(result.current.error).toBeNull()
    expect(result.current.reconciliation?.draftId).toBe('b')
  })

  it('invalidates a completed comparison immediately when the draft version changes', async () => {
    const next = deferred<InvoiceDraftKsefReconciliation>()
    const client = { ksef: vi.fn().mockResolvedValueOnce(data()).mockReturnValueOnce(next.promise) }
    const { result, rerender } = renderHook(({ current }) => useInvoiceKsefReconciliation(current, client), { initialProps: { current: draft() } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ current: draft('a', 2) })
    expect(result.current.reconciliation).toBeNull()
    expect(result.current.approvalBlockReason).toBeTruthy()
    await act(async () => next.resolve(data('a', 2)))
    expect(result.current.approvalBlockReason).toBeNull()
  })

  it('keeps approval blocked when the returned comparison has a different version or an unresolved link', async () => {
    const client = { ksef: vi.fn().mockResolvedValue(data('a', 2)) }
    const { result } = renderHook(() => useInvoiceKsefReconciliation(draft(), client))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.approvalBlockReason).toContain('zmieniły')
    client.ksef.mockResolvedValue({ ...data(), links: [{ approvalBlocked: true }] })
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.approvalBlockReason).toContain('Rozstrzygnij')
  })

  it('aborts the active comparison request on unmount', () => {
    const pending = deferred<InvoiceDraftKsefReconciliation>()
    const client = { ksef: vi.fn().mockReturnValue(pending.promise) }
    const { unmount } = renderHook(() => useInvoiceKsefReconciliation(draft(), client))
    const signal = client.ksef.mock.calls[0][1] as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
