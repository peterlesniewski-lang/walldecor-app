export const SYSTEM_LEAVE_TYPES = [
  { code: 'VL',  name: 'Urlop wypoczynkowy',       color: '#3B82F6', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: 26,   parentCode: null },
  { code: 'VLD', name: 'Urlop na żądanie',          color: '#8B5CF6', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: 4,    parentCode: 'VL' },
  { code: 'SL',  name: 'Zwolnienie chorobowe',      color: '#EF4444', isPaid: true,  requiresApproval: false, tracksBalance: false, maxDaysPerYear: null, parentCode: null },
  { code: 'UB',  name: 'Urlop bezpłatny',           color: '#64748B', isPaid: false, requiresApproval: true,  tracksBalance: false, maxDaysPerYear: null, parentCode: null },
  { code: 'RW',  name: 'Praca zdalna',              color: '#10B981', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'RWO', name: 'Okazjonalna praca zdalna',  color: '#6EE7B7', isPaid: true,  requiresApproval: false, tracksBalance: true,  maxDaysPerYear: 24,   parentCode: null },
  { code: 'DEL', name: 'Delegacja',                 color: '#7C3AED', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'ML',  name: 'Urlop macierzyński',        color: '#EC4899', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'PL',  name: 'Urlop tacierzyński',        color: '#F59E0B', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'UO',  name: 'Urlop opiekuńczy',          color: '#F97316', isPaid: false, requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: 5,    parentCode: null },
  { code: 'OT',  name: 'Czas wolny za nadgodziny',  color: '#14B8A6', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'FIL', name: 'Opieka nad chorym',         color: '#FB923C', isPaid: true,  requiresApproval: false, tracksBalance: true,  maxDaysPerYear: 2,    parentCode: null },
  { code: 'VBL', name: 'Urlop dodatkowy',           color: '#60A5FA', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
  { code: 'VSL', name: 'Urlop wolontariacki',       color: '#34D399', isPaid: false, requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: 6,    parentCode: null },
  { code: 'ZOW', name: 'Zwolnienie z pracy',        color: '#94A3B8', isPaid: true,  requiresApproval: true,  tracksBalance: true,  maxDaysPerYear: null, parentCode: null },
] as const

export type SystemLeaveType = (typeof SYSTEM_LEAVE_TYPES)[number]

export function buildSystemLeaveTypeUpsert(leaveType: SystemLeaveType) {
  const sharedData = {
    name: leaveType.name,
    color: leaveType.color,
    isPaid: leaveType.isPaid,
    requiresApproval: leaveType.requiresApproval,
    tracksBalance: leaveType.tracksBalance,
    maxDaysPerYear: leaveType.maxDaysPerYear,
    parentId: null,
  }

  return {
    update: sharedData,
    create: {
      code: leaveType.code,
      ...sharedData,
      isActive: true,
    },
  }
}

export const CANONICAL_LEAVE_TYPE_CODES = ['VL', 'VLD', 'SL', 'UB'] as const

export type CanonicalLeaveTypeCode =
  (typeof CANONICAL_LEAVE_TYPE_CODES)[number]

export const CANONICAL_LEAVE_TYPE_CODE_SET: ReadonlySet<CanonicalLeaveTypeCode> =
  new Set(CANONICAL_LEAVE_TYPE_CODES)

export function isCanonicalLeaveTypeCode(
  code: string
): code is CanonicalLeaveTypeCode {
  return CANONICAL_LEAVE_TYPE_CODES.some(
    (canonicalCode) => canonicalCode === code
  )
}

export interface ProtectedLeaveTypeUpdate {
  isPaid?: boolean
  requiresApproval?: boolean
  tracksBalance?: boolean
  maxDaysPerYear?: number | null
  parentCode?: string | null
}

export const PROTECTED_LEAVE_TYPE_RULES = {
  VL: {
    isPaid: true,
    requiresApproval: true,
    tracksBalance: true,
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
} satisfies Record<CanonicalLeaveTypeCode, ProtectedLeaveTypeUpdate>

const PROTECTED_FIELD_LABELS: Record<keyof ProtectedLeaveTypeUpdate, string> = {
  isPaid: 'płatny',
  requiresApproval: 'wymaga akceptacji',
  tracksBalance: 'pomniejsza saldo',
  maxDaysPerYear: 'limit roczny',
  parentCode: 'typ nadrzędny',
}

function formatProtectedValue(value: boolean | number | string | null) {
  if (value === true) return 'tak'
  if (value === false) return 'nie'
  if (value === null) return 'brak'
  if (typeof value === 'string') return `kod ${value}`
  return String(value)
}

export function validateProtectedLeaveTypeUpdate(
  code: string,
  update: ProtectedLeaveTypeUpdate
): string | null {
  if (!isCanonicalLeaveTypeCode(code)) {
    return null
  }

  const rules: ProtectedLeaveTypeUpdate = PROTECTED_LEAVE_TYPE_RULES[code]

  const protectedFields: Array<keyof ProtectedLeaveTypeUpdate> = [
    'isPaid',
    'requiresApproval',
    'tracksBalance',
    'maxDaysPerYear',
    'parentCode',
  ]

  for (const field of protectedFields) {
    if (
      Object.prototype.hasOwnProperty.call(rules, field) &&
      Object.prototype.hasOwnProperty.call(update, field) &&
      update[field] !== rules[field]
    ) {
      return `Typ ${code}: chroniona reguła „${PROTECTED_FIELD_LABELS[field]}” wymaga wartości ${formatProtectedValue(rules[field]!)}.`
    }
  }

  return null
}
