import { describe, expect, it } from 'vitest'
import { requiresProxySession } from '@/proxy'

describe('AI API transport', () => {
  it('lets exact authenticated AI APIs return JSON errors rather than login HTML', () => {
    for (const pathname of ['/api/ai/chat', '/api/knowledge/ai', '/api/ai/jobs/job-1', '/api/ai/jobs/job-1/retry', '/api/internal/ai-worker']) {
      expect(requiresProxySession(pathname), pathname).toBe(false)
    }
  })

  it('does not exempt neighboring routes or application pages', () => {
    for (const pathname of ['/api/ai/chat-extra', '/api/knowledge/ai-extra', '/api/ai/jobs-extra', '/api/internal/ai-worker-extra', '/api/internal/admin', '/finance/ksef']) {
      expect(requiresProxySession(pathname), pathname).toBe(true)
    }
  })
})
