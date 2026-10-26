import '@testing-library/react'
import { afterAll, beforeAll, expect, vi } from 'vitest'

// next/font/local needs the Next build pipeline; page modules import it for CSS variables only.
vi.mock('next/font/local', () => ({
  default: (options: { variable?: string }) => ({ className: options.variable ?? 'font', variable: options.variable ?? 'font', style: {} }),
}))

// Integration databases are disposable. Never provide an application fallback key.
if (expect.getState().testPath?.includes('/integration/installations/')) {
  let previousClientLinkKey: string | undefined
  beforeAll(() => {
    previousClientLinkKey = process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY
    process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY = Buffer.alloc(32, 91).toString('base64')
  })
  afterAll(() => {
    if (previousClientLinkKey === undefined) delete process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY
    else process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY = previousClientLinkKey
  })
}
