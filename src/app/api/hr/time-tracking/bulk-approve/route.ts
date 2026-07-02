import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

const bulkApproveSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one ID required'),
  action: z.enum(['approve', 'reject']),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = bulkApproveSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { ids, action } = parsed.data
  const newStatus = action === 'approve' ? 'approved' : 'rejected'

  if (session.user.role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    const scopedWhere = getScopedEmployeeWhere(session, viewerEmployee)
    if (scopedWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [targetEntries, scopedEmployees] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { id: { in: ids } },
        select: { id: true, employeeId: true },
      }),
      prisma.employee.findMany({
        where: scopedWhere,
        select: { id: true },
      }),
    ])

    if (targetEntries.length !== ids.length) {
      return NextResponse.json({ error: 'One or more entries not found' }, { status: 404 })
    }

    const scopedEmployeeIds = new Set(scopedEmployees.map((employee) => employee.id))
    if (targetEntries.some((entry) => !scopedEmployeeIds.has(entry.employeeId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const result = await prisma.timeEntry.updateMany({
    where: {
      id: { in: ids },
      status: 'pending',
    },
    data: { status: newStatus },
  })

  return NextResponse.json({ updated: result.count })
}
