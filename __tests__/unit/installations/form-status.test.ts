import { describe, expect, it } from 'vitest'
import { deriveInstallationFormStatus } from '@/lib/installations/form-status'

describe('deriveInstallationFormStatus', () => {
  it('applies the client-form lifecycle precedence independently from clarifications', () => {
    expect(deriveInstallationFormStatus({ hasSnapshot: false, activeLink: null, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 })).toMatchObject({ code: 'NO_FORM', label: 'Brak formularza', requiresClarification: false })
    expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: null, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 })).toMatchObject({ code: 'READY_TO_SEND', label: 'Do wysłania' })
    expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: { sentAt: null, lastOpenedAt: null }, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 })).toMatchObject({ code: 'READY_TO_SEND', label: 'Do wysłania' })
    expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: { sentAt: new Date(), lastOpenedAt: null }, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 })).toMatchObject({ code: 'WAITING', label: 'Wysłany · czeka na klienta' })
    expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: { sentAt: new Date(), lastOpenedAt: new Date() }, hasDraft: true, hasSubmitted: false, openBlockingCount: 0 })).toMatchObject({ code: 'IN_PROGRESS', label: 'Rozpoczęty' })
    expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: null, hasDraft: true, hasSubmitted: true, openBlockingCount: 1 })).toMatchObject({ code: 'COMPLETED', label: 'Wypełniony', requiresClarification: true })
  })

  it('treats only a keyed current draft as a draft fact', () => {
    expect(deriveInstallationFormStatus({ hasSnapshot: true, activeLink: null, hasDraft: false, hasSubmitted: false, openBlockingCount: 0 }).code).toBe('READY_TO_SEND')
  })
})
