import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import { z } from 'zod'

const updateSchema = z.object({
  clockIn: z.coerce.date().optional(),
  clockOut: z.coerce.date().optional().nullable(),
  projectId: z.string().optional().nullable(),
  taskName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  totalMinutes: z.number().int().min(0).optional().nullable(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const accessEntry = await prisma.timeEntry.findUnique({
    where: { id },
    select: {
      employeeId: true,
      employee: { select: { id: true, divisionId: true, active: true } },
    },
  })

  if (!accessEntry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // EMPLOYEE can only see their own entries; MANAGER only entries from their division.
  if (session.user.role === 'EMPLOYEE' && accessEntry.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.user.role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    if (!canViewEmployeeRecord(session, accessEntry.employee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    include: {
      breaks: { orderBy: { startTime: 'asc' } },
      project: true,
      employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
  })

  return NextResponse.json(entry)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const existing = await prisma.timeEntry.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, divisionId: true, active: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user.role === 'MANAGER') {
    const viewerEmployee = session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
    if (!canViewEmployeeRecord(session, existing.employee, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data

  // Recalculate totalMinutes if clockIn/clockOut provided
  let totalMinutes = data.totalMinutes !== undefined ? data.totalMinutes : existing.totalMinutes
  if (data.clockIn !== undefined || data.clockOut !== undefined) {
    const clockIn = data.clockIn ?? existing.clockIn
    const clockOut = data.clockOut !== undefined ? data.clockOut : existing.clockOut
    if (clockIn && clockOut) {
      totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)
    }
  }

  const entry = await prisma.timeEntry.update({
    where: { id },
    data: {
      ...(data.clockIn !== undefined && { clockIn: data.clockIn }),
      ...(data.clockOut !== undefined && { clockOut: data.clockOut }),
      ...(data.projectId !== undefined && { projectId: data.projectId }),
      ...(data.taskName !== undefined && { taskName: data.taskName }),
      ...(data.notes !== undefined && { notes: data.notes }),
      totalMinutes,
    },
    include: {
      breaks: { orderBy: { startTime: 'asc' } },
      project: true,
    },
  })

  return NextResponse.json(entry)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const existing = await prisma.timeEntry.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.timeEntry.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
