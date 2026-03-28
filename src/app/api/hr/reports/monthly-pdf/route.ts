import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Utility functions ────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '0h'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeEntryData = {
  date: Date
  totalMinutes: number | null
  overtimeMinutes: number
}

type LeaveRequestData = {
  startDate: Date
  endDate: Date
}

type EmployeeReport = {
  id: string
  firstName: string
  lastName: string
  timeEntries: TimeEntryData[]
  leaveRequests: LeaveRequestData[]
}

type EmployeeSummary = {
  name: string
  standardMinutes: number
  overtimeMinutes: number
  leaveDays: number
}

// ─── Summary calculator ───────────────────────────────────────────────────────

function calcSummary(employee: EmployeeReport, year: number, month: number): EmployeeSummary {
  let standardMinutes = 0
  let overtimeMinutes = 0

  for (const entry of employee.timeEntries) {
    const d = new Date(entry.date)
    const dow = d.getDay() // 0=Sun, 6=Sat
    const mins = entry.totalMinutes ?? 0

    if (dow === 6) {
      // Saturday = overtime
      overtimeMinutes += mins
    } else if (dow !== 0) {
      // Mon–Fri: standard hours + any overtime field
      standardMinutes += mins
      overtimeMinutes += entry.overtimeMinutes ?? 0
    }
  }

  // Count working days (Mon–Fri) covered by approved leave requests
  const daysInMonth = new Date(year, month, 0).getDate()
  let leaveDays = 0

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month - 1, day)
    const dow = dateObj.getDay()
    if (dow === 0 || dow === 6) continue // skip weekends

    const covered = employee.leaveRequests.some((lr) => {
      const s = new Date(lr.startDate)
      const e = new Date(lr.endDate)
      s.setHours(0, 0, 0, 0)
      e.setHours(23, 59, 59, 999)
      return dateObj >= s && dateObj <= e
    })
    if (covered) leaveDays++
  }

  return {
    name: `${employee.firstName} ${employee.lastName}`,
    standardMinutes,
    overtimeMinutes,
    leaveDays,
  }
}

// ─── PDF generator ────────────────────────────────────────────────────────────

function generatePDF(reports: EmployeeReport[], year: number, month: number): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const monthLabel = `${PL_MONTHS[month - 1]} ${year}`

  const summaries = reports.map((r) => calcSummary(r, year, month))

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('WallDecor', 14, 20)

  doc.setFontSize(13)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  doc.text(`Raport miesięczny — ${monthLabel}`, 14, 30)
  doc.setTextColor(0, 0, 0)

  if (summaries.length === 1) {
    // ── Single employee: summary card ────────────────────────────────────────
    const s = summaries[0]!

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`Pracownik: ${s.name}`, 14, 44)

    // Card box
    const boxX = 14
    const boxY = 52
    const boxW = pageWidth - 28
    const rowH = 14
    const boxH = rowH * 3 + 4

    doc.setDrawColor(220, 220, 220)
    doc.setFillColor(248, 247, 245)
    doc.roundedRect(boxX, boxY, boxW, boxH, 3, 3, 'FD')

    const rows = [
      { label: 'Godziny standardowe', value: formatDuration(s.standardMinutes) },
      { label: 'Nadgodziny', value: formatDuration(s.overtimeMinutes) },
      { label: 'Dni urlopu', value: `${s.leaveDays}` },
    ]

    rows.forEach((row, i) => {
      const y = boxY + 10 + i * rowH
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(80, 80, 80)
      doc.text(row.label, boxX + 8, y)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0, 0, 0)
      doc.text(row.value, boxX + boxW - 8, y, { align: 'right' })
    })

    // Signature block
    const sigY = boxY + boxH + 20
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text('Pracownik: ___________________________', 14, sigY)
    doc.text('Kierownik: ___________________________', pageWidth / 2 + 10, sigY)

  } else {
    // ── All employees: summary table ─────────────────────────────────────────
    const tableBody = summaries.map((s) => [
      s.name,
      formatDuration(s.standardMinutes),
      formatDuration(s.overtimeMinutes),
      `${s.leaveDays}`,
    ])

    autoTable(doc, {
      startY: 40,
      head: [['Pracownik', 'Godz. standardowe', 'Nadgodziny', 'Dni urlopu']],
      body: tableBody,
      styles: { fontSize: 9, cellPadding: 3, font: 'helvetica' },
      headStyles: {
        fillColor: [30, 30, 30],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [248, 247, 245] },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 38, halign: 'right' },
        2: { cellWidth: 30, halign: 'right' },
        3: { cellWidth: 26, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = ((doc as any).lastAutoTable?.finalY ?? 100) as number
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(`Łącznie: ${summaries.length} pracowników`, 14, finalY + 8)
    doc.setTextColor(0, 0, 0)
  }

  return doc
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month')
    const employeeIdParam = searchParams.get('employeeId') ?? 'all'

    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "month" parameter (expected YYYY-MM)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const [yearStr, monthStr] = monthParam.split('-')
    const year = parseInt(yearStr!, 10)
    const month = parseInt(monthStr!, 10)

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return new Response(JSON.stringify({ error: 'Invalid month value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { start, end } = getMonthRange(year, month)
    const role = session.user.role
    const sessionEmployeeId = session.user.employeeId

    let filterIds: string[] | undefined
    if (role === 'EMPLOYEE') {
      if (!sessionEmployeeId) {
        return new Response(
          JSON.stringify({ error: 'No employee record linked to your account' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        )
      }
      filterIds = [sessionEmployeeId]
    } else {
      if (employeeIdParam !== 'all') filterIds = [employeeIdParam]
    }

    const employeesRaw = await prisma.employee.findMany({
      where: filterIds ? { id: { in: filterIds } } : { active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    })

    if (employeesRaw.length === 0) {
      return new Response(JSON.stringify({ error: 'No employees found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const allIds = employeesRaw.map((e) => e.id)

    const [timeEntriesRaw, leaveRequestsRaw] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { employeeId: { in: allIds }, date: { gte: start, lte: end } },
        select: { employeeId: true, date: true, totalMinutes: true, overtimeMinutes: true },
        orderBy: { date: 'asc' },
      }),
      prisma.leaveRequestNew.findMany({
        where: {
          employeeId: { in: allIds },
          status: 'approved',
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
    ])

    const entriesByEmployee = new Map<string, TimeEntryData[]>()
    const leaveByEmployee = new Map<string, LeaveRequestData[]>()
    for (const emp of employeesRaw) {
      entriesByEmployee.set(emp.id, [])
      leaveByEmployee.set(emp.id, [])
    }
    for (const e of timeEntriesRaw) entriesByEmployee.get(e.employeeId)?.push(e)
    for (const l of leaveRequestsRaw) leaveByEmployee.get(l.employeeId)?.push(l)

    const reports: EmployeeReport[] = employeesRaw.map((emp) => ({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      timeEntries: entriesByEmployee.get(emp.id) ?? [],
      leaveRequests: leaveByEmployee.get(emp.id) ?? [],
    }))

    const doc = generatePDF(reports, year, month)
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="raport-${monthParam}.pdf"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
