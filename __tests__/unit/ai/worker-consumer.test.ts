// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiWorkerConsumer } from '@/lib/ai/worker-consumer'
import { AiWorkerTransportError, type ParsedAiWorkerClaim } from '@/lib/ai/worker-client'
import { CodexRunError, type CodexFailureCode } from '@/lib/ai/codex-policy'
import { aiJobResultJsonSchema, type AiJobResult } from '@/lib/ai/contracts'

const claim: ParsedAiWorkerClaim = { id: 'job-one', kind: 'FINANCE_CHAT', leaseToken: 'c80d6c22-af27-43a3-bef1-1fc0ed7fa7de',
  leaseUntil: '2026-09-10T12:01:00.000Z', prompt: 'Prepared private prompt', schema: aiJobResultJsonSchema('FINANCE_CHAT') }
const lease = { workerId: 'worker-one', jobId: claim.id, leaseToken: claim.leaseToken }
const answer = { answer: 'Validated result' }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const transport = { claim: vi.fn().mockResolvedValue(claim), heartbeat: vi.fn().mockResolvedValue({ leaseUntil: claim.leaseUntil }), document: vi.fn(), finish: vi.fn().mockResolvedValue(undefined) }
  const runJob = vi.fn<(job: ParsedAiWorkerClaim, signal: AbortSignal) => Promise<AiJobResult>>().mockResolvedValue(answer)
  const consumer = createAiWorkerConsumer({ transport, workerId: lease.workerId, runJob })
  return { transport, runJob, consumer }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('single-inflight AI worker consumer', () => {
  it('rejects an empty worker identity or unsafe heartbeat interval', () => {
    const { transport, runJob } = setup()
    expect(() => createAiWorkerConsumer({ transport, runJob, workerId: '' })).toThrow('RUNNER_ERROR')
    for (const heartbeatIntervalMs of [0, -1, 10_001, Number.NaN]) {
      expect(() => createAiWorkerConsumer({ transport, runJob, workerId: 'worker-one', heartbeatIntervalMs })).toThrow('RUNNER_ERROR')
    }
  })

  it('returns idle for an empty queue without starting a model or heartbeat', async () => {
    const { consumer, transport, runJob } = setup()
    transport.claim.mockResolvedValueOnce(null)
    expect(await consumer.runOnce()).toBe('idle')
    expect(runJob).not.toHaveBeenCalled()
    expect(transport.heartbeat).not.toHaveBeenCalled()
    expect(transport.finish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('confirms the lease before inference and finishes only after the runner settles', async () => {
    const { consumer, transport, runJob } = setup()
    const initialHeartbeat = deferred<{ leaseUntil: string }>()
    const inference = deferred<AiJobResult>()
    transport.heartbeat.mockReturnValueOnce(initialHeartbeat.promise)
    runJob.mockReturnValueOnce(inference.promise)
    const running = consumer.runOnce()
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.heartbeat).toHaveBeenCalledWith(lease, expect.any(AbortSignal))
    expect(runJob).not.toHaveBeenCalled()
    initialHeartbeat.resolve({ leaseUntil: claim.leaseUntil })
    await vi.advanceTimersByTimeAsync(0)
    expect(runJob).toHaveBeenCalledWith(claim, expect.any(AbortSignal))
    expect(transport.finish).not.toHaveBeenCalled()
    inference.resolve(answer)
    expect(await running).toBe('succeeded')
    expect(transport.finish).toHaveBeenCalledWith(lease, { status: 'SUCCEEDED', result: answer }, expect.any(AbortSignal))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects concurrent runOnce calls without claiming a second job', async () => {
    const { consumer, transport, runJob } = setup()
    const inference = deferred<AiJobResult>()
    runJob.mockReturnValueOnce(inference.promise)
    const running = consumer.runOnce()
    await vi.advanceTimersByTimeAsync(0)
    expect(await consumer.runOnce()).toBe('failed')
    expect(transport.claim).toHaveBeenCalledTimes(1)
    expect(runJob).toHaveBeenCalledTimes(1)
    inference.resolve(answer)
    expect(await running).toBe('succeeded')
  })

  it('serializes periodic heartbeats without overlap when one HTTP call is slow', async () => {
    const { consumer, transport, runJob } = setup()
    const inference = deferred<AiJobResult>()
    const slowHeartbeat = deferred<{ leaseUntil: string }>()
    runJob.mockReturnValueOnce(inference.promise)
    transport.heartbeat.mockResolvedValueOnce({ leaseUntil: claim.leaseUntil }).mockReturnValueOnce(slowHeartbeat.promise)
    const running = consumer.runOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.heartbeat).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(transport.heartbeat).toHaveBeenCalledTimes(2)
    slowHeartbeat.resolve({ leaseUntil: claim.leaseUntil })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.heartbeat).toHaveBeenCalledTimes(3)
    inference.resolve(answer)
    expect(await running).toBe('succeeded')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts on any heartbeat failure but retains ownership until the actual runner settles', async () => {
    const { consumer, transport, runJob } = setup()
    const inference = deferred<AiJobResult>()
    runJob.mockReturnValueOnce(inference.promise)
    transport.heartbeat.mockResolvedValueOnce({ leaseUntil: claim.leaseUntil }).mockRejectedValueOnce(new Error('private network details'))
    let settled = false
    const running = consumer.runOnce().then((result) => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runJob.mock.calls[0][1].aborted).toBe(true)
    expect(settled).toBe(false)
    expect(await consumer.runOnce()).toBe('failed')
    expect(transport.claim).toHaveBeenCalledTimes(1)
    expect(transport.finish).not.toHaveBeenCalled()
    inference.resolve(answer)
    expect(await running).toBe('lease_lost')
    expect(transport.finish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start inference when the initial heartbeat fails', async () => {
    const { consumer, transport, runJob } = setup()
    transport.heartbeat.mockRejectedValueOnce(new AiWorkerTransportError('TIMEOUT'))
    expect(await consumer.runOnce()).toBe('lease_lost')
    expect(runJob).not.toHaveBeenCalled()
    expect(transport.finish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('awaits an in-flight heartbeat before sending a success finish', async () => {
    const { consumer, transport, runJob } = setup()
    const inference = deferred<AiJobResult>()
    const heartbeat = deferred<{ leaseUntil: string }>()
    runJob.mockReturnValueOnce(inference.promise)
    transport.heartbeat.mockResolvedValueOnce({ leaseUntil: claim.leaseUntil }).mockReturnValueOnce(heartbeat.promise)
    const running = consumer.runOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    inference.resolve(answer)
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.finish).not.toHaveBeenCalled()
    heartbeat.resolve({ leaseUntil: claim.leaseUntil })
    expect(await running).toBe('succeeded')
    expect(transport.finish).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards a completed result if the pending heartbeat fails before finish', async () => {
    const { consumer, transport, runJob } = setup()
    const inference = deferred<AiJobResult>()
    const heartbeat = deferred<{ leaseUntil: string }>()
    runJob.mockReturnValueOnce(inference.promise)
    transport.heartbeat.mockResolvedValueOnce({ leaseUntil: claim.leaseUntil }).mockReturnValueOnce(heartbeat.promise)
    const running = consumer.runOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    inference.resolve(answer)
    await vi.advanceTimersByTimeAsync(0)
    heartbeat.reject(new AiWorkerTransportError('LEASE_LOST'))
    expect(await running).toBe('lease_lost')
    expect(transport.finish).not.toHaveBeenCalled()
  })

  it('propagates outer abort immediately but awaits process settlement and never finishes', async () => {
    const { consumer, transport, runJob } = setup()
    const inference = deferred<AiJobResult>()
    const abort = new AbortController()
    runJob.mockReturnValueOnce(inference.promise)
    let settled = false
    const running = consumer.runOnce(abort.signal).then((result) => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(runJob.mock.calls[0][1].aborted).toBe(true)
    expect(settled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    inference.reject(new CodexRunError('RUNNER_ERROR'))
    expect(await running).toBe('lease_lost')
    expect(transport.finish).not.toHaveBeenCalled()
  })

  it.each(['AUTH', 'QUOTA', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'INVALID_RESULT', 'RUNNER_ERROR'] as CodexFailureCode[])('maps runner %s to a controlled outcome without re-executing', async (code) => {
    const { consumer, transport, runJob } = setup()
    runJob.mockRejectedValueOnce(new CodexRunError(code))
    expect(await consumer.runOnce()).toBe('failed')
    expect(transport.finish).toHaveBeenCalledWith(lease, { status: ['AUTH', 'QUOTA', 'MODEL_UNAVAILABLE'].includes(code) ? 'BLOCKED' : 'FAILED', errorCode: code }, expect.any(AbortSignal))
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hides unknown runner exceptions and passes private document handles only to the runner adapter', async () => {
    const { consumer, transport, runJob } = setup()
    const documentClaim = { ...claim, kind: 'INVOICE_EXTRACT', document: { attachmentId: 'private-attachment' } }
    transport.claim.mockResolvedValueOnce(documentClaim)
    runJob.mockRejectedValueOnce(new Error('private-token-and-url'))
    expect(await consumer.runOnce()).toBe('failed')
    expect(runJob.mock.calls[0][0]).toEqual(documentClaim)
    expect(transport.finish.mock.calls[0][1]).toEqual({ status: 'FAILED', errorCode: 'RUNNER_ERROR' })
  })

  it('never repeats inference when finish acknowledgement is lost', async () => {
    const { consumer, transport, runJob } = setup()
    transport.finish.mockRejectedValueOnce(new AiWorkerTransportError('TIMEOUT'))
    expect(await consumer.runOnce()).toBe('failed')
    transport.claim.mockResolvedValueOnce(null)
    expect(await consumer.runOnce()).toBe('idle')
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(transport.finish).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns only a controlled status after claim failure or a pre-aborted call', async () => {
    const { consumer, transport, runJob } = setup()
    transport.claim.mockRejectedValueOnce(new Error('secret raw transport failure'))
    expect(await consumer.runOnce()).toBe('failed')
    const abort = new AbortController()
    abort.abort()
    expect(await consumer.runOnce(abort.signal)).toBe('lease_lost')
    expect(transport.claim).toHaveBeenCalledTimes(1)
    expect(runJob).not.toHaveBeenCalled()
  })
})
