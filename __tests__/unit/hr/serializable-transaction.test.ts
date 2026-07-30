import { describe, expect, it, vi } from 'vitest'
import {
  SerializableTransactionConflictError,
  runSerializableTransactionWithRetry,
} from '@/lib/hr/serializable-transaction'

function prismaError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

describe('runSerializableTransactionWithRetry', () => {
  it('retries a P2034 write conflict and returns the next result', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(prismaError('P2034', 'Write conflict'))
      .mockResolvedValue('committed')
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await runSerializableTransactionWithRetry(operation, {
      initialDelayMs: 5,
      sleep,
    })

    expect(result).toBe('committed')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(5)
  })

  it('retries an expired P2028 transaction', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(prismaError(
        'P2028',
        'Transaction already closed because of an expired transaction'
      ))
      .mockResolvedValue('committed')

    await expect(runSerializableTransactionWithRetry(operation, {
      initialDelayMs: 0,
    })).resolves.toBe('committed')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('uses deterministic exponential delays between three attempts', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(prismaError('P2034', 'Write conflict'))
      .mockRejectedValueOnce(prismaError('P2034', 'Write conflict'))
      .mockResolvedValue('committed')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await runSerializableTransactionWithRetry(operation, {
      initialDelayMs: 4,
      sleep,
    })

    expect(sleep.mock.calls).toEqual([[4], [8]])
  })

  it('throws a typed conflict after exhausting three attempts', async () => {
    const operation = vi.fn().mockRejectedValue(
      prismaError('P2034', 'Write conflict')
    )

    await expect(runSerializableTransactionWithRetry(operation, {
      initialDelayMs: 0,
    })).rejects.toBeInstanceOf(SerializableTransactionConflictError)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('does not retry domain or validation errors', async () => {
    const domainError = new Error('Insufficient leave balance')
    const operation = vi.fn().mockRejectedValue(domainError)
    const sleep = vi.fn()

    await expect(runSerializableTransactionWithRetry(operation, {
      sleep,
    })).rejects.toBe(domainError)
    expect(operation).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry an unrelated P2028 transaction API error', async () => {
    const transactionError = prismaError(
      'P2028',
      'Transaction API error: invalid transaction identifier'
    )
    const operation = vi.fn().mockRejectedValue(transactionError)

    await expect(runSerializableTransactionWithRetry(operation, {
      initialDelayMs: 0,
    })).rejects.toBe(transactionError)
    expect(operation).toHaveBeenCalledOnce()
  })
})
