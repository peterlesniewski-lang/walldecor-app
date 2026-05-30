import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTemplates } from '@/lib/operations/queries'
import { createChecklistTemplate } from '@/lib/operations/template-writer'
import { CreateChecklistTemplateSchema } from '@/lib/validations/operations'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const templates = await getTemplates()
  return NextResponse.json(templates)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = CreateChecklistTemplateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const template = await createChecklistTemplate(parsed.data)
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PROCEDURE') {
      return NextResponse.json({ error: 'Invalid procedure' }, { status: 400 })
    }
    throw error
  }
}
