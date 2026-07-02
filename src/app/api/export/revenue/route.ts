import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') ?? 'plan'
  const yearParam = searchParams.get('year')
  const costCenterId = searchParams.get('costCenterId') ?? undefined

  if (!['plan', 'actuals'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type. Use plan or actuals.' }, { status: 400 })
  }

  const yearFilter = yearParam ? { year: parseInt(yearParam, 10) } : {}
  const ccFilter = costCenterId ? { costCenterId } : {}

  let rows: { year: number; month: number; costCenterId: string; channel: string; amount: number }[]

  if (type === 'plan') {
    rows = await prisma.revenueBudget.findMany({
      where: { ...yearFilter, ...ccFilter },
      orderBy: [{ year: 'asc' }, { month: 'asc' }, { costCenterId: 'asc' }],
    })
  } else {
    rows = await prisma.revenue.findMany({
      where: { ...yearFilter, ...ccFilter },
      orderBy: [{ year: 'asc' }, { month: 'asc' }, { costCenterId: 'asc' }],
    })
  }

  const header = 'rok,miesiac,centrum_kosztow,kanal,kwota'
  const lines = rows.map((r) =>
    `${r.year},${r.month},${r.costCenterId},${r.channel},${r.amount.toFixed(2)}`
  )

  const csv = [header, ...lines].join('\n')

  const yearLabel = yearParam ?? 'all'
  const ccLabel = costCenterId ?? 'all'
  const filename = `walldecor_revenue_${type}_${yearLabel}_${ccLabel}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
