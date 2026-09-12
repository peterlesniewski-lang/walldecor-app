// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

// Only the composition boundary is replaced here. The HTTP adapter and all
// business writes are exercised against migrated SQLite in integration tests.
const handlers = vi.hoisted(() => Object.fromEntries([
  'batchesPOST', 'draftsGET', 'draftsPOST', 'draftGET', 'draftPATCH',
  'actionsPOST', 'fileGET', 'approvePOST', 'approveDELETE', 'historyGET',
  'ksefGET', 'ksefPOST',
].map((key) => [key, vi.fn()])))
vi.mock('@/lib/invoice-import/http-runtime', () => ({ invoiceImportHandlers: handlers }))

describe('invoice import Next route wiring', () => {
  it('exposes batch and collection handlers in the Node runtime', async () => {
    const batches = await import('@/app/api/finance/invoice-import/batches/route')
    const drafts = await import('@/app/api/finance/invoice-import/drafts/route')
    expect(batches.runtime).toBe('nodejs')
    expect(batches.POST).toBe(handlers.batchesPOST)
    expect(drafts.runtime).toBe('nodejs')
    expect(drafts.GET).toBe(handlers.draftsGET)
    expect(drafts.POST).toBe(handlers.draftsPOST)
  })

  it('awaits Next 16 params for each document operation', async () => {
    const request = new NextRequest('http://localhost/api/finance/invoice-import/drafts/document-1')
    const context = { params: Promise.resolve({ id: 'document-1' }) }
    const detail = await import('@/app/api/finance/invoice-import/drafts/[id]/route')
    const actions = await import('@/app/api/finance/invoice-import/drafts/[id]/actions/route')
    const file = await import('@/app/api/finance/invoice-import/drafts/[id]/file/route')
    const approval = await import('@/app/api/finance/invoice-import/drafts/[id]/approve/route')
    const history = await import('@/app/api/finance/invoice-import/drafts/[id]/history/route')
    const ksef = await import('@/app/api/finance/invoice-import/drafts/[id]/ksef/route')
    const response = NextResponse.json({ passed: true })
    for (const [route, method, handler] of [
      [detail, 'GET', 'draftGET'], [detail, 'PATCH', 'draftPATCH'],
      [actions, 'POST', 'actionsPOST'], [file, 'GET', 'fileGET'],
      [approval, 'POST', 'approvePOST'], [approval, 'DELETE', 'approveDELETE'],
      [history, 'GET', 'historyGET'],
      [ksef, 'GET', 'ksefGET'], [ksef, 'POST', 'ksefPOST'],
    ] as const) {
      handlers[handler].mockResolvedValue(response)
      expect(route.runtime).toBe('nodejs')
      const invoke = (route as unknown as Record<string, (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<NextResponse>>)[method]
      expect(await invoke(request, context)).toBe(response)
      expect(handlers[handler]).toHaveBeenCalledWith(...(['draftGET', 'ksefGET'].includes(handler) ? ['document-1'] : [request, 'document-1']))
    }
  })
})
