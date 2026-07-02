import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTemplate } from '@/lib/operations/queries'
import { updateChecklistTemplate } from '@/lib/operations/template-writer'
import { UpdateChecklistTemplateSchema } from '@/lib/validations/operations'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const template = await getTemplate(id, { id: session.user.id, role: session.user.role })
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(template)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const parsed = UpdateChecklistTemplateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const template = await updateChecklistTemplate(id, parsed.data)
    return NextResponse.json(template)
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PROCEDURE') {
      return NextResponse.json({ error: 'Invalid procedure' }, { status: 400 })
    }
    throw error
  }
}
