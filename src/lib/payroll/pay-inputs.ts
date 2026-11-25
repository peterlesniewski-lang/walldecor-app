import { createHash } from 'node:crypto'
import type { BaseSegment, DerivedOvertimeLine } from './calendar'
import type { EmploymentInPeriod } from './carryover'

// "Zmiana po zatwierdzeniu" (D9): compares what an approved version's amount depended on with the
// live state, restricted to inputs that change pay. Deliberately NOT the whole calendarFingerprint:
// that covers every time entry, so an ordinary clock-in of a salaried person would raise the label
// (and a notification) every day. Pure: callers load the live state and the approved version.

export const PAY_INPUT_CHANGES = ['OVERTIME', 'BASE', 'EMPLOYMENT', 'ABSENCE', 'HOURS'] as const
export type PayInputChange = typeof PAY_INPUT_CHANGES[number]

export const PAY_INPUT_CHANGE_LABELS: Record<PayInputChange, string> = {
  OVERTIME: 'nadgodziny',
  BASE: 'angaż',
  EMPLOYMENT: 'daty zatrudnienia',
  ABSENCE: 'nieobecność',
  HOURS: 'godziny',
}

/**
 * The pay-relevant inputs of one person-month, normalised so that equal inputs serialise equally.
 * `null` marks an input that is not compared for this version (see `PayInputsTracking`).
 */
export type PayInputsState = {
  /** Time entries with overtime: [timeEntryId, overtimeMinutes, entryStatus], sorted by id. */
  overtime: Array<[string, number, string]>
  /** Base salary segments in the month: [from, amountGrosze, basis], sorted by date. */
  base: Array<[string, number, string]>
  employment: EmploymentInPeriod | null
  /** Approved pay-affecting absences (ids), sorted. */
  absenceIds: string[] | null
  /** Approved worked minutes; compared only for an hourly basis. */
  workedMinutes: number | null
}

/** Which inputs a version can be compared on. */
export type PayInputsTracking = {
  /** Versions approved before stage 1 have no `inputs` key: only overtime and base are compared. */
  inputs: boolean
  /** Worked minutes matter only when pay is hours × rate. */
  hours: boolean
}

export type ApprovedVersionInputs = {
  snapshotJson: string
  approvedWorkedMinutes: number
  baseBasis: string
}

export type LivePayInputs = {
  overtimeLines: Array<Pick<DerivedOvertimeLine, 'timeEntryId' | 'overtimeMinutes' | 'entryStatus'>>
  baseSegments: Array<Pick<BaseSegment, 'from' | 'amountGrosze' | 'basis'>>
  approvedWorkedMinutes: number
  employment: EmploymentInPeriod
  absenceIds: string[]
}

type VersionSnapshot = {
  overtimeLines?: Array<{ timeEntryId: string; overtimeMinutes: number; entryStatus: string }>
  baseSegments?: Array<{ from: string; amountGrosze: number; basis: string }>
  inputs?: { employment: EmploymentInPeriod; payAffectingAbsenceIds: string[] }
}

function parseSnapshot(json: string): VersionSnapshot {
  try {
    const value = JSON.parse(json) as unknown
    return typeof value === 'object' && value !== null ? value as VersionSnapshot : {}
  } catch {
    return {}
  }
}

const HOURLY = 'HOURLY_GROSS'

export function payInputsTracking(version: ApprovedVersionInputs, liveSegments: Array<{ basis: string }>): PayInputsTracking {
  const snapshot = parseSnapshot(version.snapshotJson)
  return {
    inputs: snapshot.inputs !== undefined,
    hours: version.baseBasis === HOURLY
      || (snapshot.baseSegments ?? []).some((segment) => segment.basis === HOURLY)
      || liveSegments.some((segment) => segment.basis === HOURLY),
  }
}

function normalize(
  parts: {
    overtime: Array<{ timeEntryId: string; overtimeMinutes: number; entryStatus: string }>
    base: Array<{ from: string; amountGrosze: number; basis: string }>
    employment: EmploymentInPeriod | null
    absenceIds: string[] | null
    workedMinutes: number
  },
  tracking: PayInputsTracking
): PayInputsState {
  return {
    overtime: parts.overtime
      .filter((line) => line.overtimeMinutes > 0)
      .map((line): [string, number, string] => [line.timeEntryId, line.overtimeMinutes, line.entryStatus])
      .sort((a, b) => a[0].localeCompare(b[0])),
    base: parts.base
      .map((segment): [string, number, string] => [segment.from, segment.amountGrosze, segment.basis])
      .sort((a, b) => a[0].localeCompare(b[0])),
    employment: tracking.inputs && parts.employment ? { from: parts.employment.from, to: parts.employment.to } : null,
    absenceIds: tracking.inputs && parts.absenceIds ? [...parts.absenceIds].sort() : null,
    workedMinutes: tracking.hours ? parts.workedMinutes : null,
  }
}

/** The inputs as they were when the version was approved. */
export function approvedPayInputs(version: ApprovedVersionInputs, tracking: PayInputsTracking): PayInputsState {
  const snapshot = parseSnapshot(version.snapshotJson)
  return normalize({
    overtime: snapshot.overtimeLines ?? [],
    base: snapshot.baseSegments ?? [],
    employment: snapshot.inputs?.employment ?? null,
    absenceIds: snapshot.inputs?.payAffectingAbsenceIds ?? null,
    workedMinutes: version.approvedWorkedMinutes,
  }, tracking)
}

/** The same inputs as they are now. */
export function livePayInputs(live: LivePayInputs, tracking: PayInputsTracking): PayInputsState {
  return normalize({
    overtime: live.overtimeLines,
    base: live.baseSegments,
    employment: live.employment,
    absenceIds: live.absenceIds,
    workedMinutes: live.approvedWorkedMinutes,
  }, tracking)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Kinds of pay-relevant input that differ between two states, in a fixed order. */
export function diffPayInputs(before: PayInputsState, after: PayInputsState): PayInputChange[] {
  const changes: PayInputChange[] = []
  if (!same(before.overtime, after.overtime)) changes.push('OVERTIME')
  if (!same(before.base, after.base)) changes.push('BASE')
  if (!same(before.employment, after.employment)) changes.push('EMPLOYMENT')
  if (!same(before.absenceIds, after.absenceIds)) changes.push('ABSENCE')
  if (!same(before.workedMinutes, after.workedMinutes)) changes.push('HOURS')
  return changes
}

/** Stable signature of a state; "Kwota aktualna" records it, the daily notice remembers it. */
export function payInputsSignature(state: PayInputsState): string {
  return createHash('sha256')
    .update(JSON.stringify([state.overtime, state.base, state.employment, state.absenceIds, state.workedMinutes]))
    .digest('hex')
}

export type PayChangesAcknowledgement = { signature: string; state: PayInputsState | null }

export type ChangeAfterApproval = {
  /** What differs from the approved version, or from the last acknowledged state if there is one. */
  changes: PayInputChange[]
  /** Signature of the live state; acknowledging it hides the label until the next change. */
  signature: string
  state: PayInputsState
}

/**
 * null when the approved amount is still based on the current inputs, or when exactly the current
 * state has been acknowledged ("Kwota aktualna") for this version.
 */
export function evaluateChangeAfterApproval(input: {
  version: ApprovedVersionInputs
  live: LivePayInputs
  acknowledgement: PayChangesAcknowledgement | null
}): ChangeAfterApproval | null {
  const tracking = payInputsTracking(input.version, input.live.baseSegments)
  const approved = approvedPayInputs(input.version, tracking)
  const current = livePayInputs(input.live, tracking)
  const sinceApproval = diffPayInputs(approved, current)
  if (sinceApproval.length === 0) return null
  const signature = payInputsSignature(current)
  if (input.acknowledgement?.signature === signature) return null
  const sinceAcknowledgement = input.acknowledgement?.state ? diffPayInputs(input.acknowledgement.state, current) : []
  return {
    changes: sinceAcknowledgement.length > 0 ? sinceAcknowledgement : sinceApproval,
    signature,
    state: current,
  }
}

/** "nieobecność, nadgodziny" */
export function describePayInputChanges(changes: PayInputChange[]): string {
  return changes.map((change) => PAY_INPUT_CHANGE_LABELS[change]).join(', ')
}

export const CHANGE_AFTER_APPROVAL_LABEL = 'zmiana po zatwierdzeniu — sprawdź kwotę'
