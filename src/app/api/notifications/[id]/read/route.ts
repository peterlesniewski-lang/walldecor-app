import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  if (id === 'all') {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, isRead: false },
      data: { isRead: true },
    })
    return NextResponse.json({ success: true })
  }

  // Verify ownership before marking as read
  const notification = await prisma.notification.findUnique({ where: { id } })
  if (!notification) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (notification.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  })

  return NextResponse.json({ success: true })
}
