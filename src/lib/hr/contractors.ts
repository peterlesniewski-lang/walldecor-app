import type { Prisma } from '@/generated/prisma'

// The single place that defines an external contractor (owner decision D12): an Employee card with
// employment type B2B. The company has no staff on B2B; such cards are subcontractors invoicing for
// work and exist for the installations module and installer accounts. No dedicated database field.

export const EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE = 'B2B'

export function isExternalContractor(employee: { employmentType: string | null | undefined }): boolean {
  return employee.employmentType === EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE
}

/**
 * Staff = everyone who is not an external contractor, INCLUDING cards without an employment type
 * (D14: nobody may disappear because of missing data). Prisma's `{ not: 'B2B' }` alone would also
 * drop NULL rows, hence the explicit OR. When a query already has its own `OR`, combine via `AND`.
 */
export const STAFF_WHERE = {
  OR: [
    { employmentType: null },
    { employmentType: { not: EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE } },
  ],
} satisfies Prisma.EmployeeWhereInput

export const CONTRACTOR_WHERE = {
  employmentType: EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE,
} satisfies Prisma.EmployeeWhereInput

// Which cards a list shows: HR staff, external contractors, or everybody (the default of the API,
// so that callers written before the contractors tab keep working).
export type EmployeeKind = 'staff' | 'contractors' | 'all'

export function parseEmployeeKind(value: string | null | undefined): EmployeeKind | null {
  if (value === undefined || value === null || value === '') return null
  return value === 'staff' || value === 'contractors' || value === 'all' ? value : null
}

export function employeeKindWhere(kind: EmployeeKind): Prisma.EmployeeWhereInput {
  if (kind === 'staff') return STAFF_WHERE
  if (kind === 'contractors') return CONTRACTOR_WHERE
  return {}
}
