import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PayrollError } from './service'

/** Payroll data is ADMIN-only (spec: MANAGER has no access to pay data, EMPLOYEE only to own — later stage). */
export async function requirePayrollAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

export function payrollErrorResponse(error: unknown) {
  if (error instanceof PayrollError) {
    return NextResponse.json(
      { error: error.message, ...(error.details ? { details: error.details } : {}) },
      { status: error.status }
    )
  }
  // Database guards (triggers / partial unique index) are the last line of defence.
  const guardMessage = /append-only|are immutable|cannot be deleted|is locked|is not a draft|requires its effective version|soft-deleted/
  // Prisma reports SQLite trigger aborts as P2003; payroll routes validate real foreign keys upfront.
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  if (error instanceof Error && (code === 'P2002' || code === 'P2003' || guardMessage.test(error.message))) {
    console.warn('[payroll] database guard rejected a write', error.message)
    return NextResponse.json({ error: 'Operacja zablokowana przez zabezpieczenia danych płacowych.' }, { status: 409 })
  }
  console.error('[payroll] unexpected error', error)
  return NextResponse.json({ error: 'Nie udało się zapisać rozliczenia.' }, { status: 500 })
}

export const PAYROLL_NO_STORE = { 'Cache-Control': 'no-store, private' }
