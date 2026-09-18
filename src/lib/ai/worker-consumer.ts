import type { AiJobResult } from './contracts'
import { CodexRunError } from './codex-policy'
import { aiPauseReason } from './queue-errors'
import { AiWorkerTransportError, type AiWorkerOutcome, type AiWorkerTransport, type ParsedAiWorkerClaim } from './worker-client'

export type AiWorkerRunStatus = 'idle' | 'succeeded' | 'failed' | 'lease_lost'

function wait(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ready: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(ready) }
    const abort = () => finish(false)
    const timer = setTimeout(() => finish(true), milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/**
 * Caller MUST acquire the shared OS/OAuth flock before entering its loop and
 * retain it until runOnce settles. The in-process guard is not a global lock.
 * runJob MUST settle only after its provider process has actually closed,
 * including after abort. No Promise.race may release that ownership early.
 */
export function createAiWorkerConsumer(config: {
  transport: AiWorkerTransport; workerId: string
  runJob: (claim: ParsedAiWorkerClaim, signal: AbortSignal) => Promise<AiJobResult>
  heartbeatIntervalMs?: number
}): { runOnce: (signal?: AbortSignal) => Promise<AiWorkerRunStatus> } {
  const interval = config.heartbeatIntervalMs ?? 10_000
  if (typeof config.workerId !== 'string' || !config.workerId.trim() || config.workerId.length > 191 ||
    !Number.isInteger(interval) || interval < 1 || interval > 10_000) throw new CodexRunError('RUNNER_ERROR')
  const workerId = config.workerId.trim()
  let inFlight = false

  return { async runOnce(signal) {
    if (inFlight) return 'failed'
    if (signal?.aborted) return 'lease_lost'
    inFlight = true
    const jobAbort = new AbortController()
    const sleepAbort = new AbortController()
    let lost = false
    let stopHeartbeats = false
    let heartbeatTask: Promise<void> | undefined
    const loseLease = () => { lost = true; jobAbort.abort(); sleepAbort.abort() }
    signal?.addEventListener('abort', loseLease, { once: true })

    try {
      const claim = await config.transport.claim(workerId, jobAbort.signal)
      if (lost) return 'lease_lost'
      if (!claim) return 'idle'
      const lease = { workerId, jobId: claim.id, leaseToken: claim.leaseToken }
      try { await config.transport.heartbeat(lease, jobAbort.signal) }
      catch { loseLease(); return 'lease_lost' }
      if (lost) return 'lease_lost'

      heartbeatTask = (async () => {
        while (!stopHeartbeats && !lost) {
          if (!await wait(interval, sleepAbort.signal) || stopHeartbeats || lost) return
          try { await config.transport.heartbeat(lease, jobAbort.signal) }
          catch { loseLease(); return }
        }
      })()

      let outcome: AiWorkerOutcome
      try { outcome = { status: 'SUCCEEDED', result: await config.runJob(claim, jobAbort.signal) } }
      catch (error) {
        const errorCode = error instanceof CodexRunError ? error.code : 'RUNNER_ERROR'
        outcome = { status: aiPauseReason(errorCode) ? 'BLOCKED' : 'FAILED', errorCode }
      }
      // Do not abort a healthy in-flight heartbeat merely because inference
      // finished; await its confirmation before persisting either outcome.
      stopHeartbeats = true
      sleepAbort.abort()
      await heartbeatTask
      if (lost) return 'lease_lost'
      await config.transport.finish(lease, outcome, jobAbort.signal)
      if (lost) return 'lease_lost'
      return outcome.status === 'SUCCEEDED' ? 'succeeded' : 'failed'
    } catch (error) {
      // A lost finish acknowledgement is uncertain: never re-run inference or
      // retry finish here. The next DB claim/lease check decides eligibility.
      return lost || (error instanceof AiWorkerTransportError && error.code === 'LEASE_LOST') ? 'lease_lost' : 'failed'
    } finally {
      stopHeartbeats = true
      sleepAbort.abort()
      await heartbeatTask
      signal?.removeEventListener('abort', loseLease)
      inFlight = false
    }
  } }
}
