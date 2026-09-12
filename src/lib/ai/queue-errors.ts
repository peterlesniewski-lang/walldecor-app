import { z } from 'zod'

export const aiFailureCodeSchema = z.enum([
  'QUOTA', 'AUTH', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'RUNNER_ERROR',
  'INVALID_RESULT', 'LEASE_EXPIRED', 'ACCESS_REVOKED', 'PAYLOAD_INVALID',
])
export type AiFailureCode = z.infer<typeof aiFailureCodeSchema>
export type AiPauseReason = 'QUOTA' | 'AUTH' | 'MODEL_UNAVAILABLE'

export function aiPauseReason(code: AiFailureCode): AiPauseReason | null {
  return code === 'QUOTA' || code === 'AUTH' || code === 'MODEL_UNAVAILABLE' ? code : null
}

export function sanitizeAiFailureCode(code: unknown): AiFailureCode {
  const parsed = aiFailureCodeSchema.safeParse(code)
  return parsed.success ? parsed.data : 'RUNNER_ERROR'
}

export class AiQueueError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT' | 'IDEMPOTENCY_CONFLICT' | 'JOB_NOT_RETRYABLE' | 'LEASE_LOST' | 'INVALID_RESULT',
    readonly status: number,
  ) {
    super(code)
    this.name = 'AiQueueError'
  }
}
