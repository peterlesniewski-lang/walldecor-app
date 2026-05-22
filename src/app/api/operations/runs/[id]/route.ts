import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRun } from '@/lib/operations/queries'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({
      ...run,
      items: run.items.filter((item) => item.ownerId === session.user.id),
    })
  }

  return NextResponse.json(run)
}
