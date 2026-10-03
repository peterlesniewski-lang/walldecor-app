import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRuns } from '@/lib/operations/queries'
import { runErrorResponse } from '@/lib/operations/run-http'
import { createRunFromTemplate, RunServiceError } from '@/lib/operations/run-service'
import { CreateChecklistRunSchema } from '@/lib/validations/operations'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const runs = await getRuns({ id: session.user.id, role: session.user.role })
  return NextResponse.json(runs)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = CreateChecklistRunSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const run = await createRunFromTemplate(prisma, {
      templateId: parsed.data.templateId,
      periodYear: parsed.data.periodYear,
      periodMonth: parsed.data.periodMonth ?? null,
      name: parsed.data.name,
      createdById: session.user.id,
    })
    return NextResponse.json(run, { status: 201 })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
