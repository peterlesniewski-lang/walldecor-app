import { describe, expect, it } from 'vitest'
import { requiresProxySession } from '@/proxy'

describe('invoice import API transport', () => {
  it('lets the self-authorizing import handlers return JSON 401 without a login redirect', () => {
    for (const pathname of [
      '/api/finance/invoice-import/batches',
      '/api/finance/invoice-import/drafts',
      '/api/finance/invoice-import/drafts/draft-1',
      '/api/finance/invoice-import/drafts/draft-1/actions',
      '/api/finance/invoice-import/drafts/draft-1/approve',
      '/api/finance/invoice-import/drafts/draft-1/file',
      '/api/finance/invoice-import/drafts/draft-1/history',
    ]) {
      expect(requiresProxySession(pathname), pathname).toBe(false)
    }
  })

  it('keeps neighboring financial APIs and application pages behind the proxy session', () => {
    for (const pathname of [
      '/api/finance/invoice-import-extra',
      '/api/finance/invoice-importer/drafts',
      '/api/finance/ksef/invoices',
      '/api/finance/cost-events',
      '/finance/ksef',
    ]) {
      expect(requiresProxySession(pathname), pathname).toBe(true)
    }
  })
})
