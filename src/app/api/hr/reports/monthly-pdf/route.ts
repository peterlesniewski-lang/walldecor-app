import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMonthRange, isPublicHoliday } from '@/lib/hr/utils'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Polish month names
const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

// Day name abbreviations (0=Sunday)
const DAY_NAMES = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatMinutesH(min: number): string {
  if (min <= 0) return '0:00'
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${pad(m)}`
}

function formatTimeFromDate(d: Date | null): string {
  if (!d) return '—'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type EmployeeWithData = {
  id: string
  firstName: string
  lastName: string
  timeEntries: Array<{
    date: Date
    clockIn: Date | null
    clockOut: Date | null
    totalMinutes: number | null
    breakMinutes: number | null
    notes: string | null
    project: { name: string } | null
  }>
  leaveRequestsNew: Array<{
    startDate: Date
    endDate: Date
    status: string
    leaveType: { name: string }
  }>
}

function buildEmployeePages(doc: jsPDF, emp: EmployeeWithData, year: number, month: number) {
  const { start, end } = getMonthRange(year, month)
  const monthLabel = `${PL_MONTHS[month - 1]} ${year}`

  // Build lookup maps
  const entryByDay = new Map<string, EmployeeWithData['timeEntries'][number]>()
  for (const entry of emp.timeEntries) {
    entryByDay.set(localDateStr(entry.date), entry)
  }

  // Build leave day map: dateStr -> leaveType name
  const leaveByDay = new Map<string, string>()
  for (const lr of emp.leaveRequestsNew) {
    if (lr.status === 'rejected') continue
    const cur = new Date(lr.startDate)
    cur.setHours(12, 0, 0, 0)
    const endDate = new Date(lr.endDate)
    endDate.setHours(12, 0, 0, 0)
    while (cur <= endDate) {
      leaveByDay.set(localDateStr(cur), lr.leaveType.name)
      cur.setDate(cur.getDate() + 1)
    }
  }

  // Header
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Ewidencja czasu pracy', 14, 20)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`${emp.firstName} ${emp.lastName}  —  ${monthLabel}`, 14, 28)

  // Build table rows
  const head = [['Dzień', 'Wejście', 'Wyjście', 'Godziny', 'Typ', 'Uwagi']]
  const body: Array<Array<string | { content: string; styles: Record<string, string | number> }>> = []

  let totalWorkMinutes = 0
  let saturdayMinutes = 0
  let leaveDays = 0

  const cur = new Date(start)
  cur.setHours(12, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(12, 0, 0, 0)

  while (cur <= endDay) {
    const dow = cur.getDay()
    const dateStr = localDateStr(cur)
    const dayLabel = `${DAY_NAMES[dow]} ${cur.getDate()}.${pad(cur.getMonth() + 1)}`

    const isSaturday = dow === 6
    const isSunday = dow === 0
    const isHoliday = isPublicHoliday(cur)
    const entry = entryByDay.get(dateStr)
    const leaveName = leaveByDay.get(dateStr)

    if (isHoliday) {
      body.push([dayLabel, '—', '—', '—', 'Święto ustawowe', ''])
    } else if (leaveName) {
      leaveDays++
      body.push([dayLabel, '—', '—', '—', leaveName, ''])
    } else if (entry) {
      const net = (entry.totalMinutes ?? 0) - (entry.breakMinutes ?? 0)
      const hoursStr = formatMinutesH(net)
      const typ = isSaturday ? 'Nadg. 2×' : 'Praca'

      totalWorkMinutes += net
      if (isSaturday) saturdayMinutes += net

      const row = [
        dayLabel,
        formatTimeFromDate(entry.clockIn),
        formatTimeFromDate(entry.clockOut),
        hoursStr,
        typ,
        entry.notes ?? '',
      ]

      if (isSaturday) {
        body.push(row.map((cell) => ({
          content: String(cell),
          styles: { fillColor: '#FFF3E0' },
        })))
      } else {
        body.push(row)
      }
    } else if (!isSunday) {
      // Weekday with no data — skip (don't clutter with empty rows for weekdays)
      // Only show Saturday with no data if they worked that day (handled above)
    }

    cur.setDate(cur.getDate() + 1)
  }

  autoTable(doc, {
    head,
    body,
    startY: 34,
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      font: 'helvetica',
    },
    headStyles: {
      fillColor: '#1C1C1E',
      textColor: '#FFFFFF',
      fontStyle: 'bold',
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 18 },
      2: { cellWidth: 18 },
      3: { cellWidth: 18 },
      4: { cellWidth: 35 },
      5: { cellWidth: 'auto' },
    },
    alternateRowStyles: {
      fillColor: '#F8F8F8',
    },
    margin: { left: 14, right: 14 },
  })

  // Summary rows after table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY as number
  const summaryY = finalY + 8

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(`Łącznie przepracowano:`, 14, summaryY)
  doc.setFont('helvetica', 'normal')
  doc.text(`${formatMinutesH(totalWorkMinutes)} h`, 70, summaryY)

  doc.setFont('helvetica', 'bold')
  doc.text(`Nadgodziny sobotnie (2×):`, 14, summaryY + 6)
  doc.setFont('helvetica', 'normal')
  doc.text(`${formatMinutesH(saturdayMinutes)} h`, 70, summaryY + 6)

  doc.setFont('helvetica', 'bold')
  doc.text(`Urlopy / nieobecności:`, 14, summaryY + 12)
  doc.setFont('helvetica', 'normal')
  doc.text(`${leaveDays} dni`, 70, summaryY + 12)

  // Signature line
  const sigY = summaryY + 28
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Podpis pracownika: ___________________________', 14, sigY)
  doc.text('Podpis pracodawcy: ___________________________', 110, sigY)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get('month')
  const employeeIdParam = searchParams.get('employeeId') ?? 'all'

  if (!monthParam) {
    return new Response(JSON.stringify({ error: 'month is required' }), { status: 400 })
  }

  const [yearStr, monthStr] = monthParam.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  if (isNaN(year) || isNaN(month)) {
    return new Response(JSON.stringify({ error: 'Invalid month format' }), { status: 400 })
  }

  const { start, end } = getMonthRange(year, month)

  // Build employee where clause
  const empWhere = employeeIdParam === 'all'
    ? { active: true }
    : { id: employeeIdParam }

  const employees = await prisma.employee.findMany({
    where: empWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      timeEntries: {
        where: { date: { gte: start, lte: end } },
        include: { project: { select: { name: true } } },
        orderBy: { date: 'asc' },
      },
      leaveRequestsNew: {
        where: {
          status: { not: 'rejected' },
          startDate: { lte: end },
          endDate: { gte: start },
        },
        include: { leaveType: { select: { name: true } } },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  if (employees.length === 0) {
    return new Response(JSON.stringify({ error: 'No employees found' }), { status: 404 })
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  employees.forEach((emp, idx) => {
    if (idx > 0) {
      doc.addPage()
    }
    buildEmployeePages(doc, emp, year, month)
  })

  const buffer = Buffer.from(doc.output('arraybuffer'))

  const nameSlug = employees.length === 1
    ? `${employees[0].lastName.toLowerCase()}-${employees[0].firstName.toLowerCase()}`
    : 'wszyscy'

  const filename = `raport-${nameSlug}-${monthParam}.pdf`

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
