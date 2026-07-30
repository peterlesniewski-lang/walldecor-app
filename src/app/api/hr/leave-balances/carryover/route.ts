import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  executeLeaveCarryoverBatch,
  LeaveCarryoverCanonicalVlError,
} from '@/lib/hr/leave-carryover'
import { runSerializableTransactionWithRetry } from '@/lib/hr/serializable-transaction'

const carryoverSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
  maxCarryoverDays: z.number().min(0).optional(),
  reason: z.string().trim().min(3).max(1000),
}).refine((data) => data.toYear > data.fromYear, {
  message: 'toYear must be greater than fromYear',
  path: ['toYear'],
})

function invalidInput(details?: unknown) {
  return NextResponse.json(
    {
      error: 'Invalid input',
      ...(details === undefined ? {} : { details }),
    },
    { status: 400 }
  )
}

function missingCanonicalVl() {
  return NextResponse.json(
    { error: 'Canonical leave type VL is not configured correctly' },
    { status: 503 }
  )
}

function carryoverConflict() {
  return NextResponse.json(
    {
      code: 'CARRYOVER_CONFLICT',
      error:
        'Leave balance changed during carryover. Run the operation again.',
    },
    { status: 409 }
  )
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let rawInput: unknown
  try {
    rawInput = await req.json()
  } catch {
    return invalidInput('Request body must be valid JSON')
  }

  const parsed = carryoverSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(parsed.error.flatten())

  const { fromYear, toYear, maxCarryoverDays, reason } = parsed.data
  try {
    const result = await runSerializableTransactionWithRetry(() =>
      prisma.$transaction(
        (tx) =>
          executeLeaveCarryoverBatch(tx, {
            fromYear,
            toYear,
            maxCarryoverDays,
            reason,
            actorId: session.user.id,
          }),
        { isolationLevel: 'Serializable' }
      )
    )

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof LeaveCarryoverCanonicalVlError) {
      return missingCanonicalVl()
    }
    return carryoverConflict()
  }
}
