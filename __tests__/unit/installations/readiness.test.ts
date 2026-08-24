import { describe, expect, it } from 'vitest'
import {
  assertInstallationStatusTransition,
  InstallationOrderTransitionError,
} from '@/lib/installations/state-machine'

describe('installation readiness transition', () => {
  it('blocks READY_TO_PLAN while an open blocking clarification exists', () => {
    expect(() => assertInstallationStatusTransition({
      from: 'AWAITING_CLIENT',
      to: 'READY_TO_PLAN',
      readiness: { isReady: false, openBlockingCount: 1, submittedCount: 1 },
    })).toThrow(InstallationOrderTransitionError)
  })

  it('allows READY_TO_PLAN only after a submitted form has no blocking clarification', () => {
    expect(() => assertInstallationStatusTransition({
      from: 'AWAITING_CLIENT',
      to: 'READY_TO_PLAN',
      readiness: { isReady: true, openBlockingCount: 0, submittedCount: 1 },
    })).not.toThrow()
  })
})
