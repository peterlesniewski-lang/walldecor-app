import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import {
  canViewEmployeeRecord,
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
} from '@/lib/hr/access'

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      const s = c == null ? '' : String(c)
      // Escape double quotes and wrap in quotes if contains comma, quote or newline
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    })
    .join(',')
}

function formatMinutes(min: number): string {
  if (min <= 0) return '0:00'
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

function scheduleMinutes(startTime: string, endTime: string, breakMins: number): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const total = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, total - breakMins)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const monthParam = searchParams.get('month')
  const divisionIdParam = searchParams.get('divisionId')
  const employeeIdParam = searchParams.get('employeeId')
  const projectIdParam = searchParams.get('projectId')

  if (!monthParam) {
    return NextResponse.json({ error: 'month is required' }, { status: 400 })
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
  const scopedEmployeeWhere = getScopedEmployeeWhere(session, viewerEmployee)
  const scopedEmployeeIds =
    role === 'MANAGER' && scopedEmployeeWhere.id !== HR_NO_EMPLOYEE_ACCESS_ID
      ? (await prisma.employee.findMany({ where: scopedEmployeeWhere, select: { id: true } })).map((employee) => employee.id)
      : null

  const scopedActiveEmployeeWhere = (requestedDivisionId?: string | null) => {
    const where: Record<string, unknown> = { ...scopedEmployeeWhere, active: true }
    if (where.id === HR_NO_EMPLOYEE_ACCESS_ID) return null
    if (requestedDivisionId && role === 'ADMIN') where.divisionId = requestedDivisionId
    if (requestedDivisionId && role === 'MANAGER' && viewerEmployee?.divisionId !== requestedDivisionId) return null
    return where
  }

  let csv = ''

  if (type === 'timecard') {
    if (!employeeIdParam) return NextResponse.json({ error: 'employeeId required' }, { status: 400 })

    const emp = await prisma.employee.findUnique({
      where: { id: employeeIdParam },
      select: { id: true, firstName: true, lastName: true, divisionId: true, active: true },
    })
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!canViewEmployeeRecord(session, emp, viewerEmployee)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const entries = await prisma.timeEntry.findMany({
      where: { employeeId: employeeIdParam, date: { gte: start, lte: end } },
      include: { project: { select: { name: true } } },
      orderBy: { date: 'asc' },
    })

    const lines: string[] = [
      csvRow(['Data', 'Wejście', 'Wyjście', 'Czas brutto (h:mm)', 'Przerwy (h:mm)', 'Netto (h:mm)', 'Nadgodziny (h:mm)', 'Status', 'Projekt', 'Notatki']),
    ]
    for (const e of entries) {
      const total = e.totalMinutes ?? 0
      const brk = e.breakMinutes ?? 0
      const net = total - brk
      lines.push(csvRow([
        e.date.toISOString().split('T')[0],
        e.clockIn ? e.clockIn.toISOString().replace('T', ' ').slice(0, 16) : '',
        e.clockOut ? e.clockOut.toISOString().replace('T', ' ').slice(0, 16) : '',
        formatMinutes(total),
        formatMinutes(brk),
        formatMinutes(net),
        formatMinutes(e.overtimeMinutes ?? 0),
        e.status,
        e.project?.name ?? '',
        e.notes ?? '',
      ]))
    }
    csv = lines.join('\r\n')

  } else if (type === 'attendance') {
    const empWhere = scopedActiveEmployeeWhere(divisionIdParam)
    if (!empWhere) {
      csv = csvRow(['Pracownik', 'Oddział', 'Dni obecności', 'Godziny brutto (h:mm)', 'Netto (h:mm)', 'Nadgodziny (h:mm)', 'Nieobecności (dni)'])
    } else {

      const employees = await prisma.employee.findMany({
        where: empWhere,
        select: {
          id: true, firstName: true, lastName: true,
          division: { select: { name: true } },
          timeEntries: {
            where: { date: { gte: start, lte: end } },
            select: { totalMinutes: true, breakMinutes: true, overtimeMinutes: true },
          },
          leaveRequestsNew: {
            where: { status: 'approved', startDate: { lte: end }, endDate: { gte: start } },
            select: { days: true },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })

      const lines: string[] = [
        csvRow(['Pracownik', 'Oddział', 'Dni obecności', 'Godziny brutto (h:mm)', 'Netto (h:mm)', 'Nadgodziny (h:mm)', 'Nieobecności (dni)']),
      ]
      for (const emp of employees) {
        const presentDays = emp.timeEntries.length
        const totalMin = emp.timeEntries.reduce((s, e) => s + (e.totalMinutes ?? 0), 0)
        const brkMin = emp.timeEntries.reduce((s, e) => s + (e.breakMinutes ?? 0), 0)
        const netMin = totalMin - brkMin
        const otMin = emp.timeEntries.reduce((s, e) => s + (e.overtimeMinutes ?? 0), 0)
        const absenceDays = emp.leaveRequestsNew.reduce((s, lr) => s + lr.days, 0)
        lines.push(csvRow([
          `${emp.firstName} ${emp.lastName}`,
          emp.division?.name ?? '',
          presentDays,
          formatMinutes(totalMin),
          formatMinutes(netMin),
          formatMinutes(otMin),
          absenceDays,
        ]))
      }
      csv = lines.join('\r\n')
    }

  } else if (type === 'overtime') {
    const empWhere = scopedActiveEmployeeWhere(divisionIdParam)
    if (!empWhere) {
      csv = csvRow(['Pracownik', 'Łącznie nadgodzin (h:mm)', 'Wnioski zatw.', 'Oczekujące', 'Czas wolny (h:mm)', 'Wypłata (h:mm)'])
    } else {

      const employees = await prisma.employee.findMany({
        where: empWhere,
        select: {
          id: true, firstName: true, lastName: true,
          timeEntries: {
            where: { date: { gte: start, lte: end } },
            select: { overtimeMinutes: true },
          },
          overtimeRequests: {
            where: { date: { gte: start, lte: end } },
            select: { status: true, resolution: true, minutes: true },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })

      const lines: string[] = [
        csvRow(['Pracownik', 'Łącznie nadgodzin (h:mm)', 'Wnioski zatw.', 'Oczekujące', 'Czas wolny (h:mm)', 'Wypłata (h:mm)']),
      ]
      for (const emp of employees) {
        const totalOtMin = emp.timeEntries.reduce((s, e) => s + (e.overtimeMinutes ?? 0), 0)
        const approved = emp.overtimeRequests.filter((r) => r.status === 'approved').length
        const pending = emp.overtimeRequests.filter((r) => r.status === 'pending').length
        const timeOffMin = emp.overtimeRequests.filter((r) => r.status === 'approved' && r.resolution === 'time_off').reduce((s, r) => s + r.minutes, 0)
        const paymentMin = emp.overtimeRequests.filter((r) => r.status === 'approved' && r.resolution === 'payment').reduce((s, r) => s + r.minutes, 0)
        lines.push(csvRow([
          `${emp.firstName} ${emp.lastName}`,
          formatMinutes(totalOtMin),
          approved,
          pending,
          formatMinutes(timeOffMin),
          formatMinutes(paymentMin),
        ]))
      }
      csv = lines.join('\r\n')
    }

  } else if (type === 'projects') {
    const entryWhere: Record<string, unknown> = {
      date: { gte: start, lte: end },
      projectId: { not: null },
    }
    if (projectIdParam) entryWhere.projectId = projectIdParam
    if (scopedEmployeeIds) entryWhere.employeeId = { in: scopedEmployeeIds }
    if (role === 'MANAGER' && (!scopedEmployeeIds || scopedEmployeeIds.length === 0)) {
      csv = csvRow(['Projekt', 'Kod projektu', 'Pracownik', 'Godziny (h:mm)', '% czasu', 'Łącznie projekt (h:mm)'])
    } else {

      const entries = await prisma.timeEntry.findMany({
        where: entryWhere,
        select: {
          totalMinutes: true,
          breakMinutes: true,
          project: { select: { id: true, name: true, code: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      })

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
          projectMap.set(pid, { project: entry.project, employeeMap: new Map(), totalMinutes: 0 })
        }
        const proj = projectMap.get(pid)!
        proj.totalMinutes += net
        const eid = entry.employee.id
        if (!proj.employeeMap.has(eid)) {
          proj.employeeMap.set(eid, { ...entry.employee, minutes: 0 })
        }
        proj.employeeMap.get(eid)!.minutes += net
      }

      const lines: string[] = [
        csvRow(['Projekt', 'Kod projektu', 'Pracownik', 'Godziny (h:mm)', '% czasu', 'Łącznie projekt (h:mm)']),
      ]
      for (const { project, employeeMap, totalMinutes } of projectMap.values()) {
        for (const emp of employeeMap.values()) {
          const pct = totalMinutes > 0 ? Math.round((emp.minutes / totalMinutes) * 100) : 0
          lines.push(csvRow([
            project.name,
            project.code,
            `${emp.firstName} ${emp.lastName}`,
            formatMinutes(emp.minutes),
            `${pct}%`,
            formatMinutes(totalMinutes),
          ]))
        }
      }
      csv = lines.join('\r\n')
    }

  } else if (type === 'plan-vs-actual') {
    const empWhere = scopedActiveEmployeeWhere(divisionIdParam)
    if (!empWhere) {
      csv = csvRow(['Pracownik', 'Zaplanowane (h:mm)', 'Przepracowane (h:mm)', 'Różnica (h:mm)', '%'])
    } else {

      const employees = await prisma.employee.findMany({
        where: empWhere,
        select: {
          id: true, firstName: true, lastName: true,
          workSchedules: {
            where: { date: { gte: start, lte: end } },
            select: { startTime: true, endTime: true, breakMinutes: true },
          },
          timeEntries: {
            where: { date: { gte: start, lte: end } },
            select: { totalMinutes: true, breakMinutes: true },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })

      const lines: string[] = [
        csvRow(['Pracownik', 'Zaplanowane (h:mm)', 'Przepracowane (h:mm)', 'Różnica (h:mm)', '%']),
      ]
      for (const emp of employees) {
        const planned = emp.workSchedules.reduce((s, ws) => s + scheduleMinutes(ws.startTime, ws.endTime, ws.breakMinutes), 0)
        const actual = emp.timeEntries.reduce((s, e) => s + (e.totalMinutes ?? 0) - (e.breakMinutes ?? 0), 0)
        const diff = actual - planned
        const pct = planned > 0 ? Math.round((actual / planned) * 100) : 0
        lines.push(csvRow([
          `${emp.firstName} ${emp.lastName}`,
          formatMinutes(planned),
          formatMinutes(actual),
          formatMinutes(Math.abs(diff)) + (diff < 0 ? ' (brak)' : ''),
          `${pct}%`,
        ]))
      }
      csv = lines.join('\r\n')
    }

  } else {
    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
  }

  // Add BOM for Excel UTF-8 compatibility
  const bom = '\uFEFF'
  return new NextResponse(bom + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="raport-${type}-${monthParam}.csv"`,
    },
  })
}
