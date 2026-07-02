export interface BuildAdminSeedUserUpsertInput {
  adminEmail: string
  adminUsername: string
  passwordHash: string
  resetExistingPassword: boolean
}

export function buildAdminSeedUserUpsert(input: BuildAdminSeedUserUpsertInput) {
  const passwordFields = {
    passwordHash: input.passwordHash,
    mustChangePassword: false,
    passwordChangedAt: new Date(),
  }

  return {
    update: input.resetExistingPassword
      ? {
          username: input.adminUsername,
          ...passwordFields,
        }
      : {
          username: input.adminUsername,
        },
    create: {
      username: input.adminUsername,
      email: input.adminEmail,
      name: 'Administrator WallDecor',
      role: 'ADMIN' as const,
      ...passwordFields,
    },
  }
}
