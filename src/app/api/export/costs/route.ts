import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') ?? 'budget'
  const yearParam = searchParams.get('year')
  const costCenterId = searchParams.get('costCenterId') ?? undefined

  if (!['budget', 'actuals'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type. Use budget or actuals.' }, { status: 400 })
  }

  const yearFilter = yearParam ? { year: parseInt(yearParam, 10) } : {}
  const ccFilter = costCenterId ? { costCenterId } : {}

  let rows: { year: number; month: number; costCenterId: string; amount: number; subCategory: { name: string; category: { name: string } } }[]

  if (type === 'budget') {
    rows = await prisma.budgetEntry.findMany({
      where: { ...yearFilter, ...ccFilter },
      include: { subCategory: { include: { category: true } } },
      orderBy: [{ year: 'asc' }, { month: 'asc' }, { costCenterId: 'asc' }],
    })
  } else {
    rows = await prisma.actualEntry.findMany({
      where: { ...yearFilter, ...ccFilter },
      include: { subCategory: { include: { category: true } } },
      orderBy: [{ year: 'asc' }, { month: 'asc' }, { costCenterId: 'asc' }],
    })
  }

  const header = 'rok,miesiac,centrum_kosztow,kategoria,podkategoria,kwota'
  const lines = rows.map((r) => {
    const kategoria = r.subCategory.category.name.replace(/,/g, ';')
    const podkategoria = r.subCategory.name.replace(/,/g, ';')
    return `${r.year},${r.month},${r.costCenterId},${kategoria},${podkategoria},${r.amount.toFixed(2)}`
  })

  const csv = [header, ...lines].join('\n')

  const yearLabel = yearParam ?? 'all'
  const ccLabel = costCenterId ?? 'all'
  const filename = `walldecor_${type}_${yearLabel}_${ccLabel}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
