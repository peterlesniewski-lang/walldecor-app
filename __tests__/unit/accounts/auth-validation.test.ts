import { describe, expect, it } from 'vitest'
import { ChangePasswordSchema, LoginSchema } from '@/lib/validations/auth'

describe('LoginSchema', () => {
  it('should normalize a messy login into an ascii username', () => {
    const result = LoginSchema.safeParse({ username: '  Łukasz Żółć ', password: 'secret' })

    expect(result.success).toBe(true)
    expect(result.data?.username).toBe('lukaszzolc')
  })

  it('should reject a username that becomes shorter than 2 chars after normalization', () => {
    // 'a!' passes the raw .min(2) check but strips to 'a' — caught by the post-transform refine
    const result = LoginSchema.safeParse({ username: 'a!', password: 'secret' })

    expect(result.success).toBe(false)
  })

  it('should reject a login that strips to an empty string', () => {
    const result = LoginSchema.safeParse({ username: '!!', password: 'secret' })

    expect(result.success).toBe(false)
  })

  it('should reject an empty password', () => {
    const result = LoginSchema.safeParse({ username: 'abodeka', password: '' })

    expect(result.success).toBe(false)
  })

  it('should accept a valid username and password pair', () => {
    const result = LoginSchema.safeParse({ username: 'A. Bodeka', password: 'hunter2' })

    expect(result.success).toBe(true)
    expect(result.data?.username).toBe('abodeka')
  })
})

describe('ChangePasswordSchema', () => {
  const validPayload = {
    currentPassword: 'oldPass1!',
    newPassword: 'StrongPass1!',
    confirmPassword: 'StrongPass1!',
  }

  it('should accept a strong password that matches its confirmation', () => {
    const result = ChangePasswordSchema.safeParse(validPayload)

    expect(result.success).toBe(true)
  })

  it('should reject a new password that is too short', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      newPassword: 'Short1!',
      confirmPassword: 'Short1!',
    })

    expect(result.success).toBe(false)
  })

  it('should reject a new password without an uppercase letter', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      newPassword: 'strongpass1!',
      confirmPassword: 'strongpass1!',
    })

    expect(result.success).toBe(false)
  })

  it('should reject a new password without a lowercase letter', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      newPassword: 'STRONGPASS1!',
      confirmPassword: 'STRONGPASS1!',
    })

    expect(result.success).toBe(false)
  })

  it('should reject a new password without a digit', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      newPassword: 'StrongPass!!',
      confirmPassword: 'StrongPass!!',
    })

    expect(result.success).toBe(false)
  })

  it('should reject a new password without a special symbol', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      newPassword: 'StrongPass12',
      confirmPassword: 'StrongPass12',
    })

    expect(result.success).toBe(false)
  })

  it('should reject when confirmPassword differs from newPassword and flag the confirmPassword path', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      confirmPassword: 'DifferentPass1!',
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'confirmPassword')).toBe(
      true,
    )
  })

  it('should reject an empty current password', () => {
    const result = ChangePasswordSchema.safeParse({
      ...validPayload,
      currentPassword: '',
    })

    expect(result.success).toBe(false)
  })
})
