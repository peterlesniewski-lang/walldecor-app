// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { normalizeUsername } from '@/lib/accounts/policy'

// Keep RED focused on missing behavior rather than module resolution.
const gate = await import('../../../scripts/validate-ai-auth-loss.mjs').catch(() => ({}))
const image = `sha256:${'b'.repeat(64)}`
const parse = (args: string[]) => 'parseAuthLossArgs' in gate ? gate.parseAuthLossArgs(args) : undefined
const workerArgs = (name = 'wd-ai-auth-loss-worker-test') => 'authLossWorkerArgs' in gate
  ? gate.authLossWorkerArgs({ image }, name) : []
const assessFailure = (evidence: unknown) => 'assessAuthLossState' in gate
  ? gate.assessAuthLossState(evidence) : { passed: false, failures: ['GATE_MISSING'] }
const assessRestart = (before: unknown, after: unknown) => 'assessAuthLossRestart' in gate
  ? gate.assessAuthLossRestart(before, after) : { passed: false, failures: ['GATE_MISSING'] }
const eventGate = (options: Record<string, unknown>) => 'createAuthLossWorkerEventGate' in gate
  ? gate.createAuthLossWorkerEventGate(options) : null
const deadline = (promise: Promise<unknown>, timeoutMs: number, signal?: AbortSignal) => 'waitForAuthLossOutcome' in gate
  ? gate.waitForAuthLossOutcome(promise, timeoutMs, signal) : Promise.resolve({ ok: false, code: 'GATE_MISSING' })

const clearedLease = { workerId: null, leaseToken: null, leaseUntil: null }
const blocked = { id: 'job-a', status: 'BLOCKED', attempts: 1, errorCode: 'AUTH', resultJson: null, ...clearedLease }
const waiting = { id: 'job-b', status: 'QUEUED', attempts: 0, errorCode: null, resultJson: null, ...clearedLease }
const stateEvidence = {
  firstFinished: { status: 'failed', stopDelayMs: 120 },
  maxObservedAttempts: 1,
  jobA: blocked,
  jobB: waiting,
  queue: { pauseReason: 'AUTH', ...clearedLease },
  panelA: { authReasonVisible: true, retryVisible: true },
  panelB: { pausedAuthReasonVisible: true, retryVisible: true },
}

describe('real missing-auth acceptance configuration', () => {
  it('requires the dedicated confirmation and one exact immutable image only', () => {
    expect(parse(['--confirm-missing-auth', '--image', image])).toEqual({ image })
  })

  it.each([
    [], ['--confirm-missing-auth'], ['--image', image],
    ['--confirm-missing-auth', '--image', 'latest'],
    ['--confirm-missing-auth', '--image', image, '--oauth-volume', 'owner-auth'],
    ['--confirm-missing-auth', '--image', image, '--provider', 'fixture'],
    ['--confirm-missing-auth', '--image', image, '--api-key', 'sentinel'],
    ['--confirm-missing-auth', '--image', image, '--bind', '0.0.0.0'],
    ['--confirm-missing-auth', '--image', image, '--image', image],
    ['--confirm-missing-auth', '--image', image, '--confirm-missing-auth'],
  ])('rejects absent, ambiguous or expanded authority %#', (...args) => {
    expect(() => parse(args)).toThrow()
  })

  it('does not read credentials or fallbacks from the inherited environment', () => {
    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC-SENTINEL-NOT-A-KEY')
    vi.stubEnv('CODEX_HOME', '/private/owner-auth')
    vi.stubEnv('AI_OAUTH_VOLUME', 'owner-auth')
    try {
      expect(parse(['--confirm-missing-auth', '--image', image])).toEqual({ image })
    } finally { vi.unstubAllEnvs() }
  })

  it('seeds distinct login names already canonical under the real production normalizer', () => {
    const fixtures = ('authLossAccountFixtures' in gate
      ? gate.authLossAccountFixtures('1720000000000-ab12cd34') : {}) as Record<string, { id: string; username: string }>
    expect(Object.keys(fixtures)).toEqual(['a', 'b'])
    expect(new Set(Object.values(fixtures).map((account) => account.username)).size).toBe(2)
    for (const account of Object.values(fixtures)) {
      expect(account.id).toMatch(/^gate-admin-[ab]-/)
      expect(account.username).toMatch(/^[a-z0-9]+$/)
      expect(normalizeUsername(account.username)).toBe(account.username)
    }
  })

  it('creates an unmodified pinned worker with separate empty OAuth tmpfs and fixed hardening', () => {
    const args = workerArgs()
    expect(args.slice(0, 5)).toEqual(['create', '--pull', 'never', '--name', 'wd-ai-auth-loss-worker-test'])
    expect(args).toContain('--read-only')
    expect(args).toContain('1000:1000')
    expect(args).toContain('no-new-privileges')
    expect(args).toContain('128')
    expect(args).toContain('512m')
    expect(args).toContain('/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728')
    expect(args).toContain('/oauth:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=16777216')
    expect(args.filter((arg: string) => arg === '--tmpfs')).toHaveLength(2)
    expect(args.filter((arg: string) => arg === '--mount')).toHaveLength(0)
    expect(args).toContain('none')
    expect(args.at(-2)).toBe(image)
    expect(args.at(-1)).toBe('worker')
    expect(args.join(' ')).not.toMatch(/type=bind|type=volume|--privileged|--publish|--entrypoint|--network host|--restart|OPENAI_API_KEY|CODEX_HOME|oauth-volume/i)
    for (const name of ['AI_WORKER_ENABLED', 'AI_WORKER_URL', 'AI_WORKER_SECRET']) {
      expect(args).toContain(name)
      expect(args.some((arg: string) => arg.startsWith(`${name}=`))).toBe(false)
    }
  })

  it('uses the reviewed clean Chromium environment helper at the launch site', () => {
    const source = readFileSync(new URL('../../../scripts/validate-ai-auth-loss.mjs', import.meta.url), 'utf8')
    expect(source).toContain("import { chatOAuthBrowserLaunchOptions } from './validate-ai-chat-oauth.mjs'")
    expect(source).toMatch(/chromium\.launch\(chatOAuthBrowserLaunchOptions\(directory\)\)/)
    expect(source).toContain('await chmod(target, 0o600)')
  })
})

describe('missing-auth state assessment', () => {
  it('accepts only the observed AUTH block plus untouched paused second job and visible UI actions', () => {
    expect(assessFailure(stateEvidence)).toEqual({ passed: true, failures: [] })
  })

  it.each([
    ['WRONG_FIRST_EVENT', { firstFinished: { status: 'succeeded', stopDelayMs: 120 } }],
    ['WORKER_STOP_TOO_LATE', { firstFinished: { status: 'failed', stopDelayMs: 10_000 } }],
    ['UNEXPECTED_RETRY_OR_CLAIM', { maxObservedAttempts: 2 }],
    ['FIRST_JOB_NOT_AUTH_BLOCKED', { jobA: { ...blocked, errorCode: 'QUOTA' } }],
    ['SECOND_JOB_NOT_PAUSED_QUEUED', { jobB: { ...waiting, attempts: 1 } }],
    ['QUEUE_NOT_AUTH_PAUSED', { queue: { ...stateEvidence.queue, pauseReason: null } }],
    ['LEASE_OR_RESULT_RETAINED', { jobA: { ...blocked, leaseToken: 'private-token' } }],
    ['FIRST_UI_AUTH_NOT_VISIBLE', { panelA: { authReasonVisible: false, retryVisible: true } }],
    ['SECOND_UI_PAUSE_NOT_VISIBLE', { panelB: { pausedAuthReasonVisible: false, retryVisible: true } }],
  ])('fails closed with controlled code %s', (code, replacement) => {
    const result = assessFailure({ ...stateEvidence, ...replacement })
    expect(result.passed).toBe(false)
    expect(result.failures).toContain(code)
  })
})

describe('paused queue restart assessment', () => {
  const before = {
    workerContainerId: 'sha256:worker-container', queueUpdatedAt: '2026-09-11T10:00:00.000Z',
    jobA: blocked, jobB: waiting,
  }
  const after = {
    workerContainerId: 'sha256:worker-container', queueUpdatedAt: '2026-09-11T10:00:01.000Z',
    jobA: blocked, jobB: waiting, queue: { pauseReason: 'AUTH', ...clearedLease },
    panelA: { authReasonVisible: true, retryVisible: true },
    panelB: { pausedAuthReasonVisible: true, retryVisible: true },
    apiReadbackMatched: true,
  }

  it('requires a real paused claim poll to advance the lease row without clearing or retrying either job', () => {
    expect(assessRestart(before, after)).toEqual({ passed: true, failures: [] })
  })

  it.each([
    ['WORKER_CONTAINER_CHANGED', { workerContainerId: 'sha256:different' }],
    ['PAUSED_CLAIM_NOT_OBSERVED', { queueUpdatedAt: before.queueUpdatedAt }],
    ['BLOCKED_JOB_CHANGED_ON_RESTART', { jobA: { ...blocked, attempts: 0 } }],
    ['WAITING_JOB_CHANGED_ON_RESTART', { jobB: { ...waiting, status: 'RUNNING', attempts: 1 } }],
    ['QUEUE_NOT_AUTH_PAUSED_AFTER_RESTART', { queue: { ...after.queue, pauseReason: null } }],
    ['AUTH_WARNINGS_NOT_VISIBLE_AFTER_RESTART', { panelB: { pausedAuthReasonVisible: true, retryVisible: false } }],
    ['RESTART_API_READBACK_MISMATCH', { apiReadbackMatched: false }],
  ])('rejects restart evidence with %s', (code, replacement) => {
    const result = assessRestart(before, { ...after, ...replacement })
    expect(result.passed).toBe(false)
    expect(result.failures).toContain(code)
  })
})

describe('worker event ordering and deadline cleanup', () => {
  it('handles an early startup failure immediately and leaves cleanup to the caller finally', async () => {
    const cleanup = vi.fn(async () => undefined)
    const lifecycle = eventGate({ stopWorker: vi.fn(), now: () => 100 })
    expect(lifecycle).not.toBeNull()
    try {
      lifecycle.observeLine('AI_WORKER_START_FAILED')
      await expect(lifecycle.startup).resolves.toEqual({ ok: false, code: 'AI_WORKER_START_FAILED' })
      await expect(lifecycle.finished).resolves.toEqual({ ok: false, code: 'AI_WORKER_START_FAILED' })
      expect(lifecycle.fatalCode()).toBe('AI_WORKER_START_FAILED')
      expect(cleanup).not.toHaveBeenCalled()
    } finally { await cleanup() }
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('keeps STARTED durable when FINISHED and stop complete before the startup waiter observes it', async () => {
    let now = 100
    const stopWorker = vi.fn(async () => { now = 140 })
    const lifecycle = eventGate({ stopWorker, now: () => now })
    lifecycle.observeLine('{"event":"AI_WORKER_STARTED"}')
    lifecycle.observeLine('{"event":"AI_JOB_FINISHED","status":"failed"}')
    await expect(lifecycle.finished).resolves.toEqual({ ok: true, value: { status: 'failed', stopDelayMs: 40 } })
    await expect(lifecycle.startup).resolves.toEqual({ ok: true })
    expect(lifecycle.startedObserved()).toBe(true)
    expect(stopWorker).toHaveBeenCalledOnce()
  })

  it('keeps a fatal event sticky when it arrives after STARTED but before FINISHED', async () => {
    const lifecycle = eventGate({ stopWorker: vi.fn(), now: () => 100 })
    lifecycle.observeLine('{"event":"AI_WORKER_STARTED"}')
    await expect(lifecycle.startup).resolves.toEqual({ ok: true })
    lifecycle.observeAttachError()
    await expect(lifecycle.finished).resolves.toEqual({ ok: false, code: 'WORKER_ATTACH_FAILED' })
    expect(lifecycle.fatalCode()).toBe('WORKER_ATTACH_FAILED')
  })

  it('keeps a later fatal event sticky even after a successful FINISHED outcome settled', async () => {
    let now = 100
    const lifecycle = eventGate({ stopWorker: async () => { now = 120 }, now: () => now })
    lifecycle.observeLine('{"event":"AI_WORKER_STARTED"}')
    lifecycle.observeLine('{"event":"AI_JOB_FINISHED","status":"failed"}')
    await expect(lifecycle.finished).resolves.toEqual({ ok: true, value: { status: 'failed', stopDelayMs: 20 } })
    lifecycle.observeOutputLimit()
    expect(lifecycle.fatalCode()).toBe('WORKER_OUTPUT_LIMIT')
  })

  it('does not mark an explicitly expected stop and attach close as fatal', () => {
    const lifecycle = eventGate({ stopWorker: vi.fn(), now: () => 100 })
    lifecycle.observeLine('{"event":"AI_WORKER_STARTED"}')
    lifecycle.expectStop()
    lifecycle.observeExit()
    expect(lifecycle.fatalCode()).toBeNull()
  })

  it('cancels the losing finish deadline without leaving a referenced timer', async () => {
    vi.useFakeTimers()
    try {
      const result = await deadline(Promise.resolve({ ok: true, value: 'finished' }), 60_000)
      expect(result).toEqual({ ok: true, value: 'finished' })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('wakes a pending deadline on abort and clears its timer', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const waiting = deadline(new Promise(() => {}), 60_000, controller.signal)
      controller.abort()
      await expect(waiting).resolves.toEqual({ ok: false, code: 'INTERRUPTED' })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
