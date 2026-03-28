import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const bulkApproveSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one ID required'),
  action: z.enum(['approve', 'reject']),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'EMPLOYEE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = bulkApproveSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { ids, action } = parsed.data
  const newStatus = action === 'approve' ? 'approved' : 'rejected'

  const result = await prisma.timeEntry.updateMany({
    where: {
      id: { in: ids },
      status: 'pending',
    },
    data: { status: newStatus },
  })

  return NextResponse.json({ updated: result.count })
}
