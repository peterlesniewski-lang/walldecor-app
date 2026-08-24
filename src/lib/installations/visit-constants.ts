export const INSTALLATION_VISIT_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED'] as const

export type InstallationVisitStatus = (typeof INSTALLATION_VISIT_STATUSES)[number]

export const INTEGRATION_SYNC_STATUSES = ['NOT_REQUESTED', 'PENDING', 'SYNCED', 'ATTENTION'] as const

export type IntegrationSyncStatus = (typeof INTEGRATION_SYNC_STATUSES)[number]

export const INTEGRATION_OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD'] as const

export type IntegrationOutboxStatus = (typeof INTEGRATION_OUTBOX_STATUSES)[number]

export const INTEGRATION_OUTBOX_OPERATIONS = ['CALENDAR_UPSERT', 'CALENDAR_CANCEL'] as const

export type IntegrationOutboxOperation = (typeof INTEGRATION_OUTBOX_OPERATIONS)[number]
