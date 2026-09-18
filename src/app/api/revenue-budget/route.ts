import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

async function retiredSalesPlan() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({
    error: 'Plan sprzedaży został wycofany. Historyczne dane pozostają zachowane. Wpisz rzeczywisty obrót w Przychodach.',
  }, { status: 410 })
}

export const GET = retiredSalesPlan
export const POST = retiredSalesPlan
