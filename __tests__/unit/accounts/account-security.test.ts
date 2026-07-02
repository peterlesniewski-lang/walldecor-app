import { describe, expect, it } from 'vitest'
import {
  generateTemporaryPassword,
  isStrongPassword,
  normalizeEmailLocalPart,
  normalizeUsername,
} from '@/lib/accounts/security'

describe('normalizeUsername', () => {
  it('normalizes login names to a lowercase ascii username', () => {
    expect(normalizeUsername('  A. Bodeka  ')).toBe('abodeka')
    expect(normalizeUsername('M Czubaszek')).toBe('mczubaszek')
    expect(normalizeUsername('Łukasz Żółć')).toBe('lukaszzolc')
  })
})

describe('normalizeEmailLocalPart', () => {
  it('normalizes dotted legacy email local parts like usernames', () => {
    expect(normalizeEmailLocalPart('jan.kowalski@walldecor.pl')).toBe('jankowalski')
    expect(normalizeEmailLocalPart('Łukasz-Żółć@walldecor.pl')).toBe('lukaszzolc')
  })
})

describe('generateTemporaryPassword', () => {
  it('generates a strong temporary password', () => {
    const password = generateTemporaryPassword()

    expect(password).toHaveLength(12)
    expect(isStrongPassword(password)).toBe(true)
  })

  it('does not return the same password repeatedly', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()))

    expect(passwords.size).toBe(20)
  })
})

describe('isStrongPassword', () => {
  it('requires uppercase, lowercase, digit, symbol, and at least 10 characters', () => {
    expect(isStrongPassword('ChangeMe123!')).toBe(true)
    expect(isStrongPassword('changeme123!')).toBe(false)
    expect(isStrongPassword('CHANGEME123!')).toBe(false)
    expect(isStrongPassword('ChangeMe!!!')).toBe(false)
    expect(isStrongPassword('ChangeMe123')).toBe(false)
    expect(isStrongPassword('Cme1!')).toBe(false)
  })
})
