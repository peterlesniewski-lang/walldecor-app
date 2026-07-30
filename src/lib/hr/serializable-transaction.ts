const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_INITIAL_DELAY_MS = 5

type Sleep = (delayMs: number) => Promise<void>

export type SerializableTransactionRetryOptions = {
  maxAttempts?: number
  initialDelayMs?: number
  sleep?: Sleep
}

export class SerializableTransactionConflictError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown
  ) {
    super(`Serializable transaction conflict after ${attempts} attempts`)
  }
}

function isPrismaErrorWithCode(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

function isRetryableSerializableConflict(error: unknown) {
  if (!isPrismaErrorWithCode(error)) return false
  if (error.code === 'P2034') return true
  if (error.code !== 'P2028') return false

  return /expired transaction|transaction already closed|database is locked|write conflict|timed out/i
    .test(error.message)
}

const defaultSleep: Sleep = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

export async function runSerializableTransactionWithRetry<T>(
  operation: () => Promise<T>,
  options: SerializableTransactionRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableSerializableConflict(error)) throw error
      if (attempt === maxAttempts) {
        throw new SerializableTransactionConflictError(attempt, error)
      }

      await sleep(initialDelayMs * 2 ** (attempt - 1))
    }
  }

  throw new SerializableTransactionConflictError(maxAttempts, undefined)
}
