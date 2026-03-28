import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange } from '@/lib/hr/utils'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Utility functions ────────────────────────────────────────────────────────

function formatHHMM(iso: string | null | Date | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

const PL_DAYS = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']
const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeEntryData = {
  date: Date
  clockIn: Date
  clockOut: Date | null
  totalMinutes: number | null
  breakMinutes: number | null
  overtimeMinutes: number
  status: string
  notes: string | null
}

type LeaveRequestData = {
  startDate: Date
  endDate: Date
  leaveType: { name: string }
}

type EmployeeReport = {
  id: string
  firstName: string
  lastName: string
  timeEntries: TimeEntryData[]
  leaveRequests: LeaveRequestData[]
}

// ─── PDF section builder ──────────────────────────────────────────────────────

function generateEmployeeSection(
  doc: jsPDF,
  employee: EmployeeReport,
  year: number,
  month: number, // 1-indexed
) {
  const monthLabel = PL_MONTHS[month - 1]
  const fullName = `${employee.firstName} ${employee.lastName}`
  const pageWidth = doc.internal.pageSize.getWidth()

  // Build a quick lookup: "YYYY-MM-DD" → TimeEntry
  const entryByDate = new Map<string, TimeEntryData>()
  for (const entry of employee.timeEntries) {
    const d = new Date(entry.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    entryByDate.set(key, entry)
  }

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('WallDecor', 14, 20)

  doc.setFontSize(14)
  doc.setFont('helvetica', 'normal')
  doc.text(`Ewidencja czasu pracy — ${fullName}`, 14, 30)

  doc.setFontSize(11)
  doc.setTextColor(80, 80, 80)
  doc.text(`Miesiąc: ${monthLabel} ${year}`, 14, 38)
  doc.setTextColor(0, 0, 0)

  // ── Build table rows ──────────────────────────────────────────────────────
  const daysInMonth = new Date(year, month, 0).getDate()

  // Row: [Dzień, Data, Wejście, Wyjście, Czas pracy, Typ, Uwagi]
  // We pass fill color info via willDrawCell hook using a parallel array
  const tableRows: string[][] = []
  const rowColors: ([number, number, number] | null)[] = []

  let totalWorkDays = 0
  let totalWorkMinutes = 0
  let totalOvertimeMinutes = 0
  let totalLeaveDays = 0

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month - 1, day)
    const dow = dateObj.getDay() // 0=Sun … 6=Sat
    const dayLabel = PL_DAYS[dow]
    const mm = String(month).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const dateKey = `${year}-${mm}-${dd}`
    const dateFormatted = `${dayLabel} ${dd}.${mm}`

    const entry = entryByDate.get(dateKey)

    // Check leave requests overlapping this day
    const leaveForDay = employee.leaveRequests.find((lr) => {
      const s = new Date(lr.startDate)
      const e = new Date(lr.endDate)
      s.setHours(0, 0, 0, 0)
      e.setHours(23, 59, 59, 999)
      return dateObj >= s && dateObj <= e
    })

    const clockInStr = entry ? formatHHMM(entry.clockIn) : '—'
    const clockOutStr = entry && entry.clockOut ? formatHHMM(entry.clockOut) : '—'
    const durationStr = entry ? formatDuration(entry.totalMinutes) : '—'

    let type = ''
    if (entry && dow === 6) {
      type = 'Nadg. 2×'
    } else if (leaveForDay) {
      type = leaveForDay.leaveType.name
    } else if (entry) {
      type = 'Norma'
    }

    const notes = entry?.notes ?? ''

    // Determine background color
    let fillColor: [number, number, number] | null = null
    if (dow === 0) {
      fillColor = [240, 240, 240]
    } else if (dow === 6 && entry) {
      fillColor = [255, 237, 213]
    } else if (leaveForDay) {
      fillColor = [219, 234, 254]
    } else if (day % 2 === 0) {
      fillColor = [248, 247, 245]
    }

    tableRows.push([String(day), dateFormatted, clockInStr, clockOutStr, durationStr, type, notes])
    rowColors.push(fillColor)

    // Accumulate summaries
    if (entry && dow !== 0) {
      totalWorkDays++
      totalWorkMinutes += entry.totalMinutes ?? 0
      if (dow === 6) {
        totalOvertimeMinutes += entry.totalMinutes ?? 0
      }
    }
    if (leaveForDay && dow !== 0 && dow !== 6) {
      totalLeaveDays++
    }
  }

  // ── Render table ──────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: 45,
    head: [['Dzień', 'Data', 'Wejście', 'Wyjście', 'Czas pracy', 'Typ', 'Uwagi']],
    body: tableRows,
    styles: {
      fontSize: 8,
      cellPadding: 2,
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [30, 30, 30],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 30 },
      2: { cellWidth: 18 },
      3: { cellWidth: 18 },
      4: { cellWidth: 22 },
      5: { cellWidth: 32 },
      6: { cellWidth: 'auto' },
    },
    willDrawCell: (data) => {
      if (data.section === 'body') {
        const color = rowColors[data.row.index]
        if (color) {
          data.cell.styles.fillColor = color
        }
      }
    },
    margin: { left: 14, right: 14 },
  })

  // ── Summary footer ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY ?? 200
  const summaryY = (finalY as number) + 10

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Podsumowanie:', 14, summaryY)
  doc.setFont('helvetica', 'normal')
  doc.text(`Łącznie dni pracy: ${totalWorkDays}`, 14, summaryY + 6)
  doc.text(`Łącznie godzin: ${formatDuration(totalWorkMinutes)}`, 14, summaryY + 12)
  doc.text(`Nadgodziny (soboty): ${formatDuration(totalOvertimeMinutes)}`, 14, summaryY + 18)
  doc.text(`Dni urlopu: ${totalLeaveDays}`, 14, summaryY + 24)

  // ── Signature block ───────────────────────────────────────────────────────
  const sigY = summaryY + 40
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Pracownik: ___________________________', 14, sigY)
  doc.text('Kierownik: ___________________________', pageWidth / 2 + 10, sigY)
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

    // Validate required month param
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

    // ── Determine which employees to report ──────────────────────────────────
    // EMPLOYEE can only generate for themselves
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
      // ADMIN / MANAGER
      if (employeeIdParam !== 'all') {
        filterIds = [employeeIdParam]
      }
      // else filterIds stays undefined → fetch all active
    }

    // ── Fetch employees ───────────────────────────────────────────────────────
    const employeesRaw = await prisma.employee.findMany({
      where: {
        ...(filterIds ? { id: { in: filterIds } } : { active: true }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
      orderBy: { lastName: 'asc' },
    })

    if (employeesRaw.length === 0) {
      return new Response(JSON.stringify({ error: 'No employees found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const allEmployeeIds = employeesRaw.map((e) => e.id)

    // ── Fetch time entries for the month ──────────────────────────────────────
    const timeEntriesRaw = await prisma.timeEntry.findMany({
      where: {
        employeeId: { in: allEmployeeIds },
        date: { gte: start, lte: end },
      },
      include: {
        breaks: true,
      },
      orderBy: { date: 'asc' },
    })

    // ── Fetch approved leave requests overlapping the month ───────────────────
    const leaveRequestsRaw = await prisma.leaveRequestNew.findMany({
      where: {
        employeeId: { in: allEmployeeIds },
        status: 'approved',
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: {
        leaveType: {
          select: { name: true },
        },
      },
    })

    // ── Group by employee ─────────────────────────────────────────────────────
    const entriesByEmployee = new Map<string, TimeEntryData[]>()
    const leaveByEmployee = new Map<string, LeaveRequestData[]>()

    for (const emp of employeesRaw) {
      entriesByEmployee.set(emp.id, [])
      leaveByEmployee.set(emp.id, [])
    }

    for (const entry of timeEntriesRaw) {
      const list = entriesByEmployee.get(entry.employeeId)
      if (list) {
        list.push({
          date: entry.date,
          clockIn: entry.clockIn,
          clockOut: entry.clockOut,
          totalMinutes: entry.totalMinutes,
          breakMinutes: entry.breakMinutes,
          overtimeMinutes: entry.overtimeMinutes,
          status: entry.status,
          notes: entry.notes,
        })
      }
    }

    for (const lr of leaveRequestsRaw) {
      const list = leaveByEmployee.get(lr.employeeId)
      if (list) {
        list.push({
          startDate: lr.startDate,
          endDate: lr.endDate,
          leaveType: { name: lr.leaveType.name },
        })
      }
    }

    // ── Generate PDF ──────────────────────────────────────────────────────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    const reports: EmployeeReport[] = employeesRaw.map((emp) => ({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      timeEntries: entriesByEmployee.get(emp.id) ?? [],
      leaveRequests: leaveByEmployee.get(emp.id) ?? [],
    }))

    reports.forEach((report, idx) => {
      if (idx > 0) doc.addPage()
      generateEmployeeSection(doc, report, year, month)
    })

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
