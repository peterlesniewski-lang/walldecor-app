import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return ''
  return date.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Oczekujący',
  approved: 'Zatwierdzony',
  rejected: 'Odrzucony',
  cancelled: 'Anulowany',
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get('status') ?? undefined
  const monthFilter = searchParams.get('month') ?? undefined // format: "YYYY-MM"
  const divisionIdFilter = searchParams.get('divisionId') ?? undefined

  // Build date range from month param
  let startOfMonth: Date | undefined
  let endOfMonth: Date | undefined
  if (monthFilter) {
    const [yearStr, monthStr] = monthFilter.split('-')
    const year = parseInt(yearStr ?? '0', 10)
    const month = parseInt(monthStr ?? '0', 10)
    if (year && month) {
      startOfMonth = new Date(year, month - 1, 1)
      endOfMonth = new Date(year, month, 0, 23, 59, 59)
    }
  }

  // Determine division restriction for MANAGERs
  let effectiveDivisionId: string | undefined = divisionIdFilter
  if (role === 'MANAGER' && session.user.employeeId && !divisionIdFilter) {
    const managerEmployee = await prisma.employee.findUnique({
      where: { id: session.user.employeeId },
      select: { divisionId: true },
    })
    effectiveDivisionId = managerEmployee?.divisionId ?? undefined
  }

  const requests = await prisma.leaveRequestNew.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(startOfMonth && endOfMonth
        ? { startDate: { gte: startOfMonth, lte: endOfMonth } }
        : {}),
      ...(effectiveDivisionId
        ? { employee: { divisionId: effectiveDivisionId } }
        : {}),
    },
    include: {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          division: { select: { name: true } },
        },
      },
      leaveType: {
        select: { name: true },
      },
    },
    orderBy: { startDate: 'desc' },
  })

  // Fetch approver names
  const approverIds = [...new Set(requests.map((r) => r.approverId).filter((id): id is string => id !== null))]
  const approvers =
    approverIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, name: true },
        })
      : []
  const approverMap = new Map(approvers.map((a) => [a.id, a.name]))

  // Build CSV
  const headers = [
    'Pracownik',
    'Email',
    'Oddział',
    'Typ urlopu',
    'Od',
    'Do',
    'Dni',
    'Status',
    'Zatwierdzający',
    'Data zatwierdzenia',
    'Powód odrzucenia',
  ]

  const rows = requests.map((r) => {
    const approverName = r.approverId ? (approverMap.get(r.approverId) ?? '') : ''
    return [
      escapeCSV(`${r.employee.firstName} ${r.employee.lastName}`),
      escapeCSV(r.employee.email),
      escapeCSV(r.employee.division?.name ?? ''),
      escapeCSV(r.leaveType.name),
      escapeCSV(formatDate(r.startDate)),
      escapeCSV(formatDate(r.endDate)),
      String(r.days),
      escapeCSV(STATUS_LABELS[r.status] ?? r.status),
      escapeCSV(approverName),
      escapeCSV(formatDate(r.approvedAt)),
      escapeCSV(r.rejectionNote ?? ''),
    ].join(',')
  })

  const csvContent = [headers.join(','), ...rows].join('\n')
  const filename = monthFilter ? `wnioski-urlopowe-${monthFilter}.csv` : 'wnioski-urlopowe.csv'

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
