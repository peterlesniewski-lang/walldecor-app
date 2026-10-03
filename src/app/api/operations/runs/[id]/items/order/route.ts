import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runErrorResponse } from '@/lib/operations/run-http'
import { reorderRunItems, RunServiceError } from '@/lib/operations/run-service'
import { ReorderChecklistRunItemsSchema } from '@/lib/validations/operations'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const parsed = ReorderChecklistRunItemsSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    await reorderRunItems(prisma, id, parsed.data.itemIds)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
