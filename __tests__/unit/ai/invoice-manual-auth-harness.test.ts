// @vitest-environment node
import { describe, expect, it } from 'vitest'

// Import is inert: these tests never execute Docker, Next, browsers, or OAuth.
const gate = await import('../../../scripts/validate-invoice-manual-auth-ui.mjs').catch(() => ({}))
const call = (name: string, ...args: unknown[]) => name in gate ? gate[name](...args) : undefined
const image = 'sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab'
const args = ['--confirm-missing-auth', '--image', image]
const runId = '1789200000000-abcdef01'
const primaryId = 'primary-job'
const emptyLease = { workerId: null, leaseToken: null, leaseUntil: null }
const job = (id: string, status = 'QUEUED', attempts = 0) => ({
  id, kind: 'INVOICE_EXTRACT', status, attempts, resultJson: null,
  errorCode: status === 'BLOCKED' ? 'AUTH' : null, ...emptyLease,
})
const finalJobs = () => [job(primaryId, 'BLOCKED', 1), job('blank-original', 'CANCELLED'), job('blank-reextract')]

describe('missing-auth invoice UI harness: offline safety contracts', () => {
  it('requires explicit missing-auth consent and only the exact reviewed immutable image', () => {
    expect(call('parseInvoiceManualAuthArgs', args)).toEqual({ image })
    for (const invalid of [[], args.slice(1), [...args, '--confirm-missing-auth'], [...args, '--image', image],
      [...args, '--oauth-volume', 'owner-volume'], [...args, '--model', 'fallback'], [...args, '--retry'],
      [...args, '--bind', '0.0.0.0'], ['--confirm-missing-auth', '--image', 'latest'],
      ['--confirm-missing-auth', '--image', `sha256:${'a'.repeat(64)}`]]) {
      expect(() => call('parseInvoiceManualAuthArgs', invalid)).toThrow()
    }
  })

  it('declares a one-start one-claim budget, two UI uploads and one recognized expense', () => {
    expect(gate.INVOICE_MANUAL_AUTH_LIMITS).toEqual({
      inputFiles: 2, maximumWorkerStarts: 1, maximumQueueClaims: 1,
      maximumClaimsPerJob: 1, finalJobs: 3, approvedInvoices: 1, activeCosts: 1,
      recognizedGrossPLN: 123, firstFinishDeadlineMs: 60_000, stopAfterFinishLimitMs: 10_000,
      ownerOAuthMounted: false, providerFallback: false, automaticHarnessRetry: false,
    })
  })

  it('uses the hardened empty OAuth tmpfs worker with none logging and no mounted owner state', () => {
    const plan = call('invoiceManualAuthWorkerPlan', { image }, runId)
    expect(plan?.name).toBe(`wd-ai-auth-loss-worker-invoice-manual-${runId}`)
    expect(plan?.args.slice(0, 5)).toEqual(['create', '--pull', 'never', '--name', plan.name])
    const valuesFor = (flag: string) => plan.args.flatMap((value, index) => value === flag ? [plan.args[index + 1]] : [])
    expect(valuesFor('--tmpfs')).toContain('/oauth:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=16777216')
    expect(valuesFor('--log-driver')).toEqual(['none'])
    expect(valuesFor('--env')).toEqual(['AI_WORKER_ENABLED', 'AI_WORKER_URL', 'AI_WORKER_SECRET'])
    expect(plan.args).not.toContain('--mount')
    expect(plan.args).not.toContain('--volume')
    expect(plan.args).not.toContain('-v')
    expect(plan.args.slice(-2)).toEqual([image, 'worker'])
    expect(() => call('invoiceManualAuthWorkerPlan', { image, oauthVolume: 'owner' }, runId)).toThrow()
    expect(() => call('invoiceManualAuthWorkerPlan', { image }, '../owner')).toThrow()
  })

  it('permits exactly one worker start for the entire run and refuses all future restarts', () => {
    const permit = call('createInvoiceManualAuthStartPermit')
    expect(permit).toBeDefined()
    expect(permit.consume()).toBe(1)
    expect(permit.count()).toBe(1)
    expect(() => permit.consume()).toThrow('WORKER_RESTART_FORBIDDEN')
    expect(permit.count()).toBe(1)
  })

  it('accepts the real blocked primary and untouched cancelled/pending secondary jobs', () => {
    expect(call('assessInvoiceManualAuthBudget', [job(primaryId)], [primaryId], primaryId, 0))
      .toEqual({ passed: true, claims: 0 })
    expect(call('assessInvoiceManualAuthBudget', finalJobs(), finalJobs().map(({ id }) => id), primaryId))
      .toEqual({ passed: true, claims: 1 })
  })

  it('requires the completed AUTH claim after startup instead of accepting a reset to queued zero', () => {
    const reset = finalJobs().map((row) => row.id === primaryId ? job(primaryId) : row)
    expect(call('assessInvoiceManualAuthBudget', reset, reset.map(({ id }) => id), primaryId, 1)?.passed).toBe(false)
    expect(call('assessInvoiceManualAuthBudget', reset, reset.map(({ id }) => id), primaryId)?.passed).toBe(false)
    expect(call('assessInvoiceManualAuthBudget', finalJobs(), finalJobs().map(({ id }) => id), primaryId, 0)?.passed).toBe(false)
  })

  it('checks only an exact 123 PLN dashboard amount, allowing Polish whitespace but no extra digits', () => {
    for (const text of ['123 zł', '123,00 zł', '123.00\u00a0zł', ' 123\u202fzł ']) {
      expect(call('invoiceManualPlnAmountMatches', text)).toBe(true)
    }
    for (const text of ['1 123 zł', '1123 zł', '123,00123 zł', '-123 zł', '123 EUR', 'Koszty 123 zł']) {
      expect(call('invoiceManualPlnAmountMatches', text)).toBe(false)
    }
  })

  it('handles an aborted download waiter even when its click fails before the waiter is awaited', async () => {
    expect(typeof gate.waitForInvoiceManualDownload).toBe('function')
    const downloadFailure = Promise.reject(new Error('DOWNLOAD_ABORTED'))
    const page = { waitForEvent: () => downloadFailure }
    const click = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      throw new Error('CLICK_ABORTED')
    }
    await expect(call('waitForInvoiceManualDownload', page, click)).rejects.toThrow('CLICK_ABORTED')
  })

  it.each([
    (rows) => [...rows, job('unexpected')],
    (rows) => rows.slice(1),
    (rows) => rows.map((row, index) => index === 0 ? { ...row, kind: 'FINANCE_CHAT' } : row),
    (rows) => rows.map((row, index) => index === 0 ? { ...row, attempts: 2 } : row),
    (rows) => rows.map((row, index) => index === 0 ? { ...row, attempts: 0.5 } : row),
    (rows) => rows.map((row, index) => index === 0 ? { ...row, attempts: -1 } : row),
    (rows) => rows.map((row, index) => index === 0 ? { ...row, status: 'SUCCEEDED' } : row),
    (rows) => rows.map((row, index) => index === 0 ? { ...row, errorCode: 'QUOTA' } : row),
    (rows) => rows.map((row, index) => index === 1 ? { ...row, attempts: 1 } : row),
    (rows) => rows.map((row, index) => index === 2 ? { ...row, status: 'RUNNING' } : row),
    (rows) => rows.map((row, index) => index === 2 ? { ...row, resultJson: '{}' } : row),
    (rows) => rows.map((row, index) => index === 2 ? { ...row, leaseToken: 'retained' } : row),
  ])('fails closed on unexpected claims, results, failures, identities or leases %#', (mutate) => {
    expect(call('assessInvoiceManualAuthBudget', mutate(finalJobs()), finalJobs().map(({ id }) => id), primaryId)?.passed).toBe(false)
  })

  it('rejects missing, duplicate and oversized expected job sets', () => {
    for (const expected of [[], [primaryId, primaryId], ['other'], [primaryId, 'b', 'c', 'd']]) {
      expect(call('assessInvoiceManualAuthBudget', [job(primaryId)], expected, primaryId)?.passed).toBe(false)
    }
  })

  it('requires AUTH, one failed finish, a cleared paused lease and positive stop before manual editing', () => {
    const evidence = {
      job: job(primaryId, 'BLOCKED', 1), queue: { pauseReason: 'AUTH', ...emptyLease },
      finish: { status: 'failed', stopDelayMs: 200 }, workerStopped: true, workerStarts: 1, authUiVisible: true,
    }
    expect(call('assessInvoiceManualAuthBlocked', evidence)).toEqual({ passed: true })
    for (const change of [
      { workerStopped: false }, { workerStarts: 2 }, { authUiVisible: false },
      { finish: { status: 'succeeded', stopDelayMs: 200 } },
      { finish: { status: 'failed', stopDelayMs: 10_000 } },
      { finish: { status: 'failed', stopDelayMs: -1 } },
      { queue: { pauseReason: null, ...emptyLease } },
      { queue: { pauseReason: 'AUTH', ...emptyLease, workerId: 'still-running' } },
      { job: job(primaryId, 'FAILED', 1) },
    ]) expect(call('assessInvoiceManualAuthBlocked', { ...evidence, ...change })?.passed).toBe(false)
  })

  it('only allows cleanup of exact positively-created container IDs and names for this run', () => {
    const name = `wd-ai-auth-loss-worker-invoice-manual-${runId}`
    const id = 'b'.repeat(64)
    expect(call('invoiceManualAuthCleanupArgs', { name, id }, runId)).toEqual(['rm', '--force', id])
    for (const resource of [
      { name: 'owner-worker', id }, { name: `${name}-extra`, id }, { name, id: undefined },
      { name, id: 'owner-worker' }, { name: `wd-ai-auth-loss-worker-invoice-manual-1789200000001-abcdef01`, id },
    ]) expect(() => call('invoiceManualAuthCleanupArgs', resource, runId)).toThrow('INVALID_OWNED_RESOURCE')
  })
})
