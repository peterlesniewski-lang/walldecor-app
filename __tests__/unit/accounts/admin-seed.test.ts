import { describe, expect, it } from 'vitest'
import { buildAdminSeedUserUpsert } from '@/lib/accounts/seed-admin'

describe('buildAdminSeedUserUpsert', () => {
  it('does not overwrite the existing admin password during regular deploy seed', () => {
    const upsert = buildAdminSeedUserUpsert({
      adminEmail: 'admin@walldecor.pl',
      adminUsername: 'admin',
      passwordHash: 'new-deploy-hash',
      resetExistingPassword: false,
    })

    expect(upsert.update).toEqual({ username: 'admin' })
    expect(upsert.update).not.toHaveProperty('passwordHash')
    expect(upsert.update).not.toHaveProperty('mustChangePassword')
    expect(upsert.update).not.toHaveProperty('passwordChangedAt')
  })

  it('can intentionally reset the existing admin password when explicitly enabled', () => {
    const upsert = buildAdminSeedUserUpsert({
      adminEmail: 'admin@walldecor.pl',
      adminUsername: 'admin',
      passwordHash: 'new-deploy-hash',
      resetExistingPassword: true,
    })

    expect(upsert.update).toMatchObject({
      username: 'admin',
      passwordHash: 'new-deploy-hash',
      mustChangePassword: false,
    })
    expect(upsert.update.passwordChangedAt).toBeInstanceOf(Date)
  })

  it('creates a full admin user when the account does not exist yet', () => {
    const upsert = buildAdminSeedUserUpsert({
      adminEmail: 'admin@walldecor.pl',
      adminUsername: 'admin',
      passwordHash: 'first-hash',
      resetExistingPassword: false,
    })

    expect(upsert.create).toMatchObject({
      username: 'admin',
      email: 'admin@walldecor.pl',
      name: 'Administrator WallDecor',
      role: 'ADMIN',
      passwordHash: 'first-hash',
      mustChangePassword: false,
    })
    expect(upsert.create.passwordChangedAt).toBeInstanceOf(Date)
  })
})
