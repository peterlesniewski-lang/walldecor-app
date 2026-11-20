import type { PrismaClient } from '@/generated/prisma'

/** True when the user still exists, is an active ADMIN and does not have to change the password first. */
export async function isCurrentAdmin(db: Pick<PrismaClient, 'user'>, actorId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: actorId }, select: { role: true, isActive: true, mustChangePassword: true },
  })
  return Boolean(user && user.role === 'ADMIN' && user.isActive && !user.mustChangePassword)
}
