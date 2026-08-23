import { describe, expect, it } from 'vitest'
import {
  InstallationGovernanceValidationError,
  isClientVisitFeeActive,
  parseInstallationDelegationInput,
  parseVisitFeeOverrideInput,
} from '@/lib/installations/delegation-service'

describe('installation governance rules', () => {
  it('requires a bounded, justified delegation to a third active person', () => {
    expect(() => parseInstallationDelegationInput({
      delegateEmployeeId: 'delegate',
      startsAt: null,
      endsAt: '',
      reason: 'Nie może przejść przez cichą konwersję do daty epoch.',
    }, { primaryEmployeeId: 'primary', backupEmployeeId: 'backup' })).toThrow(expect.objectContaining({
      fieldErrors: expect.objectContaining({ startsAt: expect.any(String), endsAt: expect.any(String) }),
    }))

    expect(() => parseInstallationDelegationInput({
      delegateEmployeeId: 'primary',
      startsAt: '2026-08-23T08:00:00.000Z',
      endsAt: '2026-08-22T08:00:00.000Z',
      reason: '',
    }, { primaryEmployeeId: 'primary', backupEmployeeId: 'backup' })).toThrow(InstallationGovernanceValidationError)

    expect(() => parseInstallationDelegationInput({
      delegateEmployeeId: 'backup',
      startsAt: '2026-08-22T08:00:00.000Z',
      endsAt: '2026-08-23T08:00:00.000Z',
      reason: 'Urlop',
    }, { primaryEmployeeId: 'primary', backupEmployeeId: 'backup' })).toThrow(expect.objectContaining({
      fieldErrors: { delegateEmployeeId: expect.any(String) },
    }))

    expect(parseInstallationDelegationInput({
      delegateEmployeeId: 'delegate',
      startsAt: '2026-08-22T08:00:00.000Z',
      endsAt: '2026-08-23T08:00:00.000Z',
      reason: 'Przejęcie kontaktu podczas nieobecności.',
    }, { primaryEmployeeId: 'primary', backupEmployeeId: 'backup' })).toMatchObject({
      delegateEmployeeId: 'delegate',
      reason: 'Przejęcie kontaktu podczas nieobecności.',
    })
  })

  it('uses decimal strings for a requested gross fee and activates a client clause only after legal approval', () => {
    expect(() => parseVisitFeeOverrideInput({ grossAmount: '0', reason: 'x' })).toThrow(InstallationGovernanceValidationError)
    expect(parseVisitFeeOverrideInput({ grossAmount: '249,90', reason: 'Nietypowy dojazd.' })).toEqual({
      grossAmount: '249.90', reason: 'Nietypowy dojazd.',
    })

    expect(isClientVisitFeeActive({
      status: 'APPROVED',
      grossAmount: '249.90',
      clauseText: 'Treść sprawdzona prawnie.',
      clauseVersion: 2,
      legalApprovedAt: null,
    })).toBe(false)
    expect(isClientVisitFeeActive({
      status: 'APPROVED',
      grossAmount: '249.90',
      clauseText: 'Treść sprawdzona prawnie.',
      clauseVersion: 2,
      legalApprovedAt: new Date('2026-08-01T00:00:00.000Z'),
    }, new Date('2026-08-23T00:00:00.000Z'))).toBe(true)
    expect(isClientVisitFeeActive({
      status: 'APPROVED',
      grossAmount: '249.90',
      clauseText: 'Treść z datą zatwierdzenia dopiero w przyszłości.',
      clauseVersion: 3,
      legalApprovedAt: new Date('2026-08-24T00:00:00.000Z'),
    }, new Date('2026-08-23T00:00:00.000Z'))).toBe(false)
  })
})
