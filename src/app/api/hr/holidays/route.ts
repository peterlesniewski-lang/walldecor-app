import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getPolishHolidays } from '@/lib/hr/constants'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Polish holiday names
const POLISH_HOLIDAY_NAMES: Record<string, string> = {
  '01-01': 'Nowy Rok',
  '01-06': 'Trzech Króli',
  '05-01': 'Święto Pracy',
  '05-03': 'Święto Konstytucji',
  '08-15': 'Wniebowzięcie NMP',
  '11-01': 'Wszystkich Świętych',
  '11-11': 'Święto Niepodległości',
  '12-25': 'Boże Narodzenie',
  '12-26': 'Drugi dzień Bożego Narodzenia',
}

function getPolishHolidaysWithNames(year: number): Array<{ date: string; name: string; isNational: true }> {
  const dates = getPolishHolidays(year)
  return dates.map(date => {
    const mmdd = date.slice(5)
    let name = POLISH_HOLIDAY_NAMES[mmdd] ?? 'Święto'
    // Special: Easter and related
    if (!POLISH_HOLIDAY_NAMES[mmdd]) {
      const mmddYy = date.slice(5)
      if (mmddYy) {
        // Easter-computed holidays: Wielkanoc, Poniedziałek Wielkanocny, Boże Ciało
        name = 'Święto Kościelne'
      }
    }
    return { date, name, isNational: true as const }
  })
}

// ─── GET /api/hr/holidays?year=2026&divisionId= ───────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const yearStr = searchParams.get('year')
  const divisionId = searchParams.get('divisionId')

  const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear()
  if (isNaN(year)) return NextResponse.json({ error: 'Invalid year' }, { status: 400 })

  const rangeStart = new Date(year, 0, 1)
  const rangeEnd = new Date(year, 11, 31, 23, 59, 59)

  const customWhere: Record<string, unknown> = {
    date: { gte: rangeStart, lte: rangeEnd },
  }
  if (divisionId) {
    customWhere.OR = [{ divisionId: null }, { divisionId }]
  }

  const customHolidays = await prisma.customHoliday.findMany({
    where: customWhere,
    orderBy: { date: 'asc' },
  })

  const national = getPolishHolidaysWithNames(year)
  const custom = customHolidays.map(h => ({
    id: h.id,
    date: localIso(new Date(h.date)),
    name: h.name,
    divisionId: h.divisionId,
    isNational: false as const,
    isRecurring: h.isRecurring,
  }))

  return NextResponse.json({ national, custom })
}

// ─── POST /api/hr/holidays — add CustomHoliday (ADMIN only) ──────────────────

const customHolidayCreateSchema = z.object({
  name: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  divisionId: z.string().optional(),
  isRecurring: z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — ADMIN only' }, { status: 403 })
  }

  const parsed = customHolidayCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, date, divisionId, isRecurring } = parsed.data

  const holiday = await prisma.customHoliday.create({
    data: {
      name,
      date: new Date(date + 'T12:00:00'),
      divisionId: divisionId ?? null,
      isRecurring,
      country: 'PL',
    },
  })

  return NextResponse.json(holiday, { status: 201 })
}
