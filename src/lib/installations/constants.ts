export const INSTALLATION_ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE', 'INSTALLER'] as const

export type InstallationRole = (typeof INSTALLATION_ROLES)[number]

export const INSTALLATION_ORDER_STATUSES = [
  'DRAFT',
  'AWAITING_CLIENT',
  'READY_TO_PLAN',
  'SCHEDULED',
  'IN_PROGRESS',
  'AWAITING_ACCEPTANCE',
  'AWAITING_INVOICE',
  'CLOSED',
  'ON_HOLD',
  'CANCELLED',
  'ARCHIVED',
] as const

export type InstallationOrderStatus = (typeof INSTALLATION_ORDER_STATUSES)[number]
