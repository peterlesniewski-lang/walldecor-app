import { NextResponse } from 'next/server'
import { RunServiceError, type RunServiceErrorCode } from '@/lib/operations/run-service'

const RESPONSES: Record<RunServiceErrorCode, { status: number; error: string }> = {
  TEMPLATE_NOT_FOUND: { status: 404, error: 'Template not found' },
  EMPTY_TEMPLATE: { status: 400, error: 'Template has no items' },
  RUN_EXISTS: { status: 409, error: 'Run already exists' },
  RUN_NOT_FOUND: { status: 404, error: 'Run not found' },
  RUN_CLOSED: { status: 409, error: 'Run is closed' },
  ITEM_NOT_FOUND: { status: 404, error: 'Item not found' },
  ORDER_MISMATCH: { status: 400, error: 'Item ids do not match the run' },
  PROCEDURE_NOT_FOUND: { status: 400, error: 'Procedure not found' },
}

export function runErrorResponse(error: RunServiceError) {
  const { status, error: message } = RESPONSES[error.code]
  return NextResponse.json({ error: message, ...error.details }, { status })
}
