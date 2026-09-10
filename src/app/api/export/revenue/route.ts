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
  const type = searchParams.get('type') ?? 'actuals'
  const yearParam = searchParams.get('year')
  const costCenterId = searchParams.get('costCenterId') ?? undefined

  if (type !== 'actuals') {
    return NextResponse.json({ error: 'Eksport jest dostępny wyłącznie dla rzeczywistych obrotów.' }, { status: type === 'plan' ? 410 : 400 })
  }

  const year = yearParam ? Number(yearParam) : undefined
  if (year !== undefined && (!Number.isInteger(year) || year < 2020 || year > 2100)) {
    return NextResponse.json({ error: 'Niepoprawny rok eksportu' }, { status: 400 })
  }
  const yearFilter = year === undefined ? {} : { year }
  const ccFilter = costCenterId ? { costCenterId } : {}

  const rows = await prisma.revenue.findMany({
    where: { ...yearFilter, ...ccFilter },
    orderBy: [{ year: 'asc' }, { month: 'asc' }, { costCenterId: 'asc' }, { channel: 'asc' }],
  })

  const header = 'rok,miesiac,centrum_kosztow,kanal,kwota,stan_na_dzien'
  const lines = rows.map((r) =>
    `${r.year},${r.month},${r.costCenterId},${r.channel},${r.amount.toFixed(2)},${r.asOfDate ?? ''}`
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
