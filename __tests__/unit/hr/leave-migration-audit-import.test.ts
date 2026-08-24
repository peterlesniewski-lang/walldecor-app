import { afterEach, describe, expect, it, vi } from 'vitest'

const prismaModulePath = '../../../src/generated/prisma'

afterEach(() => {
  vi.doUnmock(prismaModulePath)
  vi.resetModules()
})

describe('HR leave migration audit module import', () => {
  it('does not construct PrismaClient at module import time', async () => {
    const prismaConstructor = vi.fn()
    const prismaModuleFactory = vi.fn(() => ({
      PrismaClient: prismaConstructor,
    }))
    vi.resetModules()
    vi.doMock(prismaModulePath, prismaModuleFactory)

    await import('../../../scripts/audit-hr-leave-migration')

    expect(prismaModuleFactory).toHaveBeenCalledOnce()
    expect(prismaConstructor).not.toHaveBeenCalled()
  })
})
