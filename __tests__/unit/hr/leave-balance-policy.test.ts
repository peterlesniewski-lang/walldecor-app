import { describe, expect, it } from 'vitest'
import {
  isOnDemandLeave,
  LeaveBalancePolicyConfigurationError,
  resolveLeaveBalancePoolId,
  shouldTrackLeaveBalance,
} from '@/lib/hr/leave-balance-policy'
import {
  buildSystemLeaveTypeUpsert,
  CANONICAL_LEAVE_TYPE_CODE_SET,
  isCanonicalLeaveTypeCode,
  PROTECTED_LEAVE_TYPE_RULES,
  SYSTEM_LEAVE_TYPES,
  validateProtectedLeaveTypeUpdate,
} from '@/lib/hr/leave-type-catalog'

const vl = { id: 'vl', code: 'VL', tracksBalance: true, parentId: null }
const vld = { id: 'vld', code: 'VLD', tracksBalance: true, parentId: 'vl' }

describe('leave balance pool policy', () => {
  it.each([
    { request: { isRemoteWork: true }, label: 'remote work' },
    { request: { isDelegation: true }, label: 'delegation' },
  ])('does not use a balance pool for $label', ({ request }) => {
    expect(resolveLeaveBalancePoolId(vl, request)).toBeNull()
  })

  it.each(['SL', 'UB'])('never tracks %s balance', (code) => {
    expect(resolveLeaveBalancePoolId({
      id: code.toLowerCase(),
      code,
      tracksBalance: true,
      parentId: null,
    })).toBeNull()
  })

  it('uses the parent balance pool for VLD', () => {
    expect(resolveLeaveBalancePoolId(vld)).toBe('vl')
  })

  it('fails closed when VLD has no parent balance pool', () => {
    expect(() => resolveLeaveBalancePoolId({
      ...vld,
      parentId: null,
    })).toThrow(LeaveBalancePolicyConfigurationError)
  })

  it('fails closed when a runtime VLD object is missing parentId', () => {
    expect(() => resolveLeaveBalancePoolId({
      id: 'vld',
      code: 'VLD',
      tracksBalance: true,
    } as never)).toThrow(LeaveBalancePolicyConfigurationError)
  })

  it('uses the leave type own pool for ordinary tracked leave', () => {
    expect(resolveLeaveBalancePoolId(vl)).toBe('vl')
  })

  it('does not use a balance pool for ordinary untracked leave', () => {
    expect(resolveLeaveBalancePoolId({
      id: 'untracked',
      code: 'OTHER',
      tracksBalance: false,
      parentId: null,
    })).toBeNull()
  })

  it('tracks leave exactly when a balance pool resolves', () => {
    expect(shouldTrackLeaveBalance(vl)).toBe(true)
    expect(shouldTrackLeaveBalance({ ...vl, tracksBalance: false })).toBe(false)
    expect(shouldTrackLeaveBalance(vl, { isRemoteWork: true })).toBe(false)
  })

  it('keeps legacy VLD tracked until parentId is explicitly selected', () => {
    const legacyVld = { id: 'vld', code: 'VLD', tracksBalance: true }
    const canonicalVld = { ...legacyVld, parentId: 'vl' }
    const canonicalVldWithoutParent = { ...legacyVld, parentId: null }

    expect(shouldTrackLeaveBalance(legacyVld)).toBe(true)
    expect(resolveLeaveBalancePoolId(canonicalVld)).toBe('vl')
    expect(shouldTrackLeaveBalance(canonicalVld)).toBe(true)
    expect(() => resolveLeaveBalancePoolId(canonicalVldWithoutParent)).toThrow(
      LeaveBalancePolicyConfigurationError
    )
    expect(() => shouldTrackLeaveBalance(canonicalVldWithoutParent)).toThrow(
      LeaveBalancePolicyConfigurationError
    )
  })

  it('recognizes VLD by type even for historical rows with isOnDemand=false', () => {
    expect(isOnDemandLeave(vld, { isOnDemand: false })).toBe(true)
  })

  it('recognizes an explicit on-demand request for another leave type', () => {
    expect(isOnDemandLeave(vl, { isOnDemand: true })).toBe(true)
    expect(isOnDemandLeave(vl, { isOnDemand: false })).toBe(false)
  })
})

describe('system leave type catalog', () => {
  it('uses unique leave type codes', () => {
    const codes = SYSTEM_LEAVE_TYPES.map(({ code }) => code)

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('clears stale parents in every first-pass system type upsert', () => {
    for (const leaveType of SYSTEM_LEAVE_TYPES) {
      const upsert = buildSystemLeaveTypeUpsert(leaveType)

      expect(upsert.update.parentId).toBeNull()
      expect(upsert.create.parentId).toBeNull()
    }
  })

  it.each([
    ['SL', {
      code: 'SL',
      name: 'Zwolnienie chorobowe',
      color: '#EF4444',
      isPaid: true,
      requiresApproval: false,
      tracksBalance: false,
      maxDaysPerYear: null,
      parentCode: null,
    }],
    ['UB', {
      code: 'UB',
      name: 'Urlop bezpłatny',
      color: '#64748B',
      isPaid: false,
      requiresApproval: true,
      tracksBalance: false,
      maxDaysPerYear: null,
      parentCode: null,
    }],
    ['VLD', {
      code: 'VLD',
      name: 'Urlop na żądanie',
      color: '#8B5CF6',
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      maxDaysPerYear: 4,
      parentCode: 'VL',
    }],
  ])('keeps the exact protected %s catalog entry', (code, expected) => {
    expect(SYSTEM_LEAVE_TYPES.find((leaveType) => leaveType.code === code)).toEqual(expected)
  })

  it('exports the exact protected leave type rules', () => {
    expect(PROTECTED_LEAVE_TYPE_RULES).toEqual({
      VL: {
        isPaid: true,
        requiresApproval: true,
        tracksBalance: true,
        parentCode: null,
      },
      SL: { tracksBalance: false },
      UB: {
        isPaid: false,
        requiresApproval: true,
        tracksBalance: false,
        maxDaysPerYear: null,
      },
      VLD: {
        requiresApproval: true,
        tracksBalance: true,
        maxDaysPerYear: 4,
        parentCode: 'VL',
      },
    })
  })

  it('recognizes only canonical leave type codes', () => {
    expect([...CANONICAL_LEAVE_TYPE_CODE_SET]).toEqual([
      'VL',
      'VLD',
      'SL',
      'UB',
    ])
    expect(isCanonicalLeaveTypeCode('VL')).toBe(true)
    expect(isCanonicalLeaveTypeCode('VLD')).toBe(true)
    expect(isCanonicalLeaveTypeCode('SL')).toBe(true)
    expect(isCanonicalLeaveTypeCode('UB')).toBe(true)
    expect(isCanonicalLeaveTypeCode('CUSTOM')).toBe(false)
  })

  it('validates only explicitly supplied canonical behavior fields', () => {
    expect(validateProtectedLeaveTypeUpdate('VL', {})).toBeNull()
    expect(validateProtectedLeaveTypeUpdate('VL', {
      maxDaysPerYear: 20,
    })).toBeNull()
    expect(validateProtectedLeaveTypeUpdate('VL', {
      isPaid: false,
    })).toMatch(/VL.*płatn/i)
    expect(validateProtectedLeaveTypeUpdate('VL', {
      parentCode: 'CUSTOM',
    })).toMatch(/VL.*nadrzędn/i)
  })
})
