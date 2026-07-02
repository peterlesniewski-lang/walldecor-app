import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { UsersManagement } from '@/components/settings/users-management'

export default async function UsersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/settings')

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      passwordChangedAt: true,
      employeeId: true,
      createdAt: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          position: true,
          divisionId: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Użytkownicy i dostęp
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Zarządzaj kontami, rolami i uprawnieniami użytkowników systemu.
        </p>
      </div>
      <UsersManagement users={users} />
    </div>
  )
}
