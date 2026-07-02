import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import { getScopedEmployeeWhere, HR_NO_EMPLOYEE_ACCESS_ID } from '@/lib/hr/access'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get('month')
  const projectIdParam = searchParams.get('projectId')

  if (!monthParam) {
    return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 })
  }

  const [yearStr, monthStr] = monthParam.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  if (isNaN(year) || isNaN(month)) {
    return NextResponse.json({ error: 'Invalid month format' }, { status: 400 })
  }

  const { start, end } = getMonthRange(year, month)
  const viewerEmployee =
    role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null
  const employeeWhere = getScopedEmployeeWhere(session, viewerEmployee)

  let scopedEmployeeIds: string[] | null = null
  if (employeeWhere.id === HR_NO_EMPLOYEE_ACCESS_ID) return NextResponse.json([])
  if (role !== 'ADMIN') {
    const scopedEmployees = await prisma.employee.findMany({
      where: employeeWhere,
      select: { id: true },
    })
    scopedEmployeeIds = scopedEmployees.map((employee) => employee.id)
    if (scopedEmployeeIds.length === 0) return NextResponse.json([])
  }

  const entryWhere: Record<string, unknown> = {
    date: { gte: start, lte: end },
    projectId: { not: null },
  }
  if (projectIdParam) entryWhere.projectId = projectIdParam
  if (scopedEmployeeIds) entryWhere.employeeId = { in: scopedEmployeeIds }

  const entries = await prisma.timeEntry.findMany({
    where: entryWhere,
    select: {
      totalMinutes: true,
      breakMinutes: true,
      projectId: true,
      project: { select: { id: true, name: true, code: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  // Group by project
  const projectMap = new Map<string, {
    project: { id: string; name: string; code: string }
    employeeMap: Map<string, { id: string; firstName: string; lastName: string; minutes: number }>
    totalMinutes: number
  }>()

  for (const entry of entries) {
    if (!entry.project) continue
    const net = (entry.totalMinutes ?? 0) - (entry.breakMinutes ?? 0)
    const pid = entry.project.id

    if (!projectMap.has(pid)) {
      projectMap.set(pid, {
        project: entry.project,
        employeeMap: new Map(),
        totalMinutes: 0,
      })
    }

    const proj = projectMap.get(pid)!
    proj.totalMinutes += net

    const eid = entry.employee.id
    if (!proj.employeeMap.has(eid)) {
      proj.employeeMap.set(eid, { ...entry.employee, minutes: 0 })
    }
    proj.employeeMap.get(eid)!.minutes += net
  }

  const result = Array.from(projectMap.values()).map(({ project, employeeMap, totalMinutes }) => ({
    project,
    totalMinutes,
    employees: Array.from(employeeMap.values()).map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      minutes: e.minutes,
      percentage: totalMinutes > 0 ? Math.round((e.minutes / totalMinutes) * 100) : 0,
    })),
  }))

  return NextResponse.json(result)
}
