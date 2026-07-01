import { describe, expect, it } from 'vitest'
import { KsefSettingsUpdateSchema, maskSecret } from '@/lib/validations/ksef-settings'

describe('KsefSettingsUpdateSchema', () => {
  it('accepts a valid token-based KSeF setup', () => {
    const result = KsefSettingsUpdateSchema.safeParse({
      enabled: true,
      environment: 'test',
      companyNip: '5250007133',
      token: 'sample-token-value',
      syncFrom: '2026-02-01',
    })

    expect(result.success).toBe(true)
  })

  it('rejects an invalid NIP shape', () => {
    const result = KsefSettingsUpdateSchema.safeParse({
      enabled: true,
      environment: 'test',
      companyNip: 'ABC123',
      token: 'sample-token-value',
      syncFrom: '2026-02-01',
    })

    expect(result.success).toBe(false)
  })

  it('allows saving non-secret settings without resubmitting the token', () => {
    const result = KsefSettingsUpdateSchema.safeParse({
      enabled: false,
      environment: 'production',
      companyNip: '5250007133',
      syncFrom: '',
    })

    expect(result.success).toBe(true)
  })
})

describe('maskSecret', () => {
  it('does not expose the full token', () => {
    expect(maskSecret('1234567890abcdef')).toBe('1234...cdef')
  })

  it('masks short secrets completely', () => {
    expect(maskSecret('abc')).toBe('***')
  })
})
