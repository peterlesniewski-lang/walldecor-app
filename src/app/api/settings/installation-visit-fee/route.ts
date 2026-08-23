import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  createInstallationVisitFeePolicy,
  InstallationGovernanceValidationError,
  listInstallationVisitFeePolicies,
} from '@/lib/installations/delegation-service'

const policySchema = z.object({
  grossAmount: z.string().trim().min(1),
  clauseText: z.string().trim().min(1),
  legalApprovedAt: z.preprocess((value) => value === '' ? null : value, z.union([z.string().trim().min(1), z.date()]).nullable().optional()),
}).strict()

function canManagePolicy(role: string) {
  return role === 'ADMIN' || role === 'MANAGER'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManagePolicy(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ policies: await listInstallationVisitFeePolicies(prisma) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManagePolicy(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const parsed = policySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Podaj kwotę i pełną treść wersji klauzuli.' }, { status: 400 })
    if (parsed.data.legalApprovedAt) {
      const legalApprovedAt = parsed.data.legalApprovedAt instanceof Date ? parsed.data.legalApprovedAt : new Date(parsed.data.legalApprovedAt)
      if (!Number.isFinite(legalApprovedAt.getTime()) || legalApprovedAt.getTime() > Date.now()) {
        return NextResponse.json({ error: 'Data zatwierdzenia prawnego nie może przypadać w przyszłości.' }, { status: 400 })
      }
    }
    const policy = await createInstallationVisitFeePolicy(prisma, { ...parsed.data, isDefault: true }, session.user.id)
    return NextResponse.json({ policy }, { status: 201 })
  } catch (error) {
    if (error instanceof InstallationGovernanceValidationError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Podaj kwotę i pełną treść wersji klauzuli.' }, { status: 400 })
    throw error
  }
}
