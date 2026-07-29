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

export const PROTECTED_LEAVE_TYPE_RULES = {
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
} as const
