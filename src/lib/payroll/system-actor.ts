// The payroll automat writes settlements, versions and audit events under this actor id. Actor
// columns have no foreign key, so the id never has to exist in User; screens resolve it to a name.

export const PAYROLL_SYSTEM_ACTOR_ID = 'system:payroll-auto'
export const PAYROLL_SYSTEM_ACTOR_NAME = 'Automat'

export const PAYROLL_VERSION_ORIGINS = ['MANUAL', 'AUTO_CARRYOVER'] as const
export type PayrollVersionOrigin = typeof PAYROLL_VERSION_ORIGINS[number]

/** Adds the automat's display name to a map of actor id → user name. */
export function withSystemActorName(actors: Record<string, string>, actorIds: string[]): Record<string, string> {
  return actorIds.includes(PAYROLL_SYSTEM_ACTOR_ID) ? { ...actors, [PAYROLL_SYSTEM_ACTOR_ID]: PAYROLL_SYSTEM_ACTOR_NAME } : actors
}
