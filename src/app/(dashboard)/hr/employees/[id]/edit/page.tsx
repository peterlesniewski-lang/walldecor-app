import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmployeeEditForm } from './employee-edit-form'

type Params = { params: Promise<{ id: string }> }

export default async function EmployeeEditPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/hr/employees')

  const { id } = await params

  const [employee, divisions, departments, positions, managers] = await Promise.all([
    prisma.employee.findUnique({
      where: { id },
      include: {
        division: true,
        department: true,
        team: true,
        positionRef: true,
        costCenter: true,
        manager: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.division.findMany({ orderBy: { name: 'asc' } }),
    prisma.department.findMany({ orderBy: { name: 'asc' } }),
    prisma.position.findMany({ orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
  ])

  if (!employee) notFound()

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      <EmployeeEditForm
        employee={employee}
        divisions={divisions}
        departments={departments}
        positions={positions}
        managers={managers.filter((m) => m.id !== id)}
      />
    </div>
  )
}
