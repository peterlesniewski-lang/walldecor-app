// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

// A missing gate must be an assertion failure during the RED step, not an
// import-resolution error which could conceal a broken test.
const gate = await import('../../../scripts/validate-ai-linux-lock.mjs').catch(() => ({}))
const assess = (proof: unknown) => 'assessSessionCase' in gate ? gate.assessSessionCase(proof) : { passed: false, failures: ['GATE_MISSING'] }
const assessReport = (positive: unknown, negative: unknown) => 'assessSessionReport' in gate ? gate.assessSessionReport(positive, negative) : { passed: false, negativeControlDetected: false }

const process = (pid: number, parentPid: number, role: string, lockFds: number[] = []) => ({ pid, parentPid, role, lockFds, state: 'S' })
function validProof() {
  const active = [process(1, 0, 'anchor'), process(12, 1, 'supervisor', [9]), process(24, 12, 'shim'), process(25, 24, 'npm-launcher', [3]), process(26, 25, 'native-cli')]
  return {
    version: 'codex-cli 0.153.4', platform: 'linux-arm64',
    before: { inode: '10:123', processes: active, contender: { exitCode: 75, stderr: 'AI_SESSION_IN_USE\n' } },
    afterSupervisorKilled: { inode: '10:123', supervisorExit: { code: null, signal: 'SIGKILL' }, processes: active.filter((p) => p.role !== 'supervisor'), contender: { exitCode: 75, stderr: 'AI_SESSION_IN_USE\n' } },
    afterDescendantExit: { inode: '10:123', processes: [active[0]], cliExit: { code: 0, signal: null }, contender: { exitCode: 0, entered: true } },
    provider: { inferenceStarted: true, authorizationPresent: false, completed: true },
  }
}

function negativeProof() {
  const proof = validProof()
  proof.afterSupervisorKilled.processes.find((p) => p.role === 'npm-launcher')!.lockFds = []
  proof.afterSupervisorKilled.contender = { exitCode: 0, stderr: '' }
  return proof
}

describe('Linux session gate rejects misleading lifecycle evidence', () => {
  it('injects its synthetic provider immediately after exec without changing the production argv tail', async () => {
    const source = await readFile(new URL('../../../scripts/validate-ai-linux-lock.mjs', import.meta.url), 'utf8')
    expect(source).toContain("if (args[0] !== 'exec') throw new Error('SYNTHETIC_EXEC_REQUIRED')")
    expect(source).toContain('args.splice(1, 0, ...overrides)')
    expect(source).not.toContain('args.splice(args.length - 1')
  })

  it('accepts actual npm launcher retaining the lock until its real native child exits', () => {
    expect(assess(validProof())).toEqual({ passed: true, failures: [] })
  })

  it('rejects a surviving synthetic shim as the only lock holder', () => {
    const proof = validProof()
    proof.afterSupervisorKilled.processes.find((p) => p.role === 'shim')!.lockFds = [3]
    proof.afterSupervisorKilled.processes.find((p) => p.role === 'npm-launcher')!.lockFds = []
    expect(assess(proof).failures).toContain('REAL_CLI_LOCK_NOT_RETAINED')
  })

  it('rejects missing FD inheritance while real CLI is still active', () => {
    const proof = validProof()
    proof.afterSupervisorKilled.processes.find((p) => p.role === 'npm-launcher')!.lockFds = []
    proof.afterSupervisorKilled.contender = { exitCode: 0, stderr: '' }
    expect(assess(proof).failures).toContain('OVERLAPPING_SESSION_ENTERED')
  })

  it('rejects killing the entire container or CLI instead of just supervisor', () => {
    const proof = validProof()
    proof.afterSupervisorKilled.processes = []
    expect(assess(proof).failures).toContain('REAL_CLI_NOT_ALIVE_AFTER_SUPERVISOR_KILL')
  })

  it('rejects a replaced lock inode even when both lock attempts were blocked', () => {
    const proof = validProof()
    proof.afterDescendantExit.inode = '10:456'
    expect(assess(proof).failures).toContain('LOCK_INODE_CHANGED')
  })

  it('rejects incomplete or failed inference and premature lock release', () => {
    const proof = validProof()
    proof.provider.completed = false
    proof.afterDescendantExit.cliExit.code = 1
    proof.afterDescendantExit.processes.push(process(26, 1, 'native-cli'))
    expect(assess(proof).passed).toBe(false)
  })

  it('passes the overall report only with the expected positive and negative outcomes', () => {
    const negative = negativeProof()
    expect(assess(negative).failures).toEqual(['REAL_CLI_LOCK_NOT_RETAINED', 'OVERLAPPING_SESSION_ENTERED'])
    expect(assessReport(validProof(), negative)).toEqual({ passed: true, negativeControlDetected: true })
  })

  it('rejects an overall pass when the negative control also changes the lock inode', () => {
    const negative = negativeProof()
    negative.afterDescendantExit.inode = '10:456'
    expect(assess(negative).failures).toContain('LOCK_INODE_CHANGED')
    expect(assessReport(validProof(), negative)).toEqual({ passed: false, negativeControlDetected: false })
  })

  it('rejects an overall pass when the negative control also fails to release the session', () => {
    const negative = negativeProof()
    negative.afterDescendantExit.contender.entered = false
    expect(assess(negative).failures).toContain('SESSION_NOT_RELEASED_AFTER_CLI_EXIT')
    expect(assessReport(validProof(), negative)).toEqual({ passed: false, negativeControlDetected: false })
  })
})
