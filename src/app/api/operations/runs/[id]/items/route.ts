import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runErrorResponse } from '@/lib/operations/run-http'
import { addRunItem, getProcedureForItem, RunServiceError } from '@/lib/operations/run-service'
import { CreateChecklistRunItemSchema } from '@/lib/validations/operations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const parsed = CreateChecklistRunItemSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const item = await addRunItem(prisma, id, parsed.data)
    const procedure = await getProcedureForItem(prisma, item.procedureId)
    return NextResponse.json({ ...item, procedure }, { status: 201 })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
