import { z } from 'zod'
import { EMPLOYMENT_TYPES, TIME_ENTRY_SOURCES, BREAK_TYPES } from './constants'

export const employeeCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  divisionId: z.string().optional(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  positionId: z.string().optional(),
  managerId: z.string().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  costCenterId: z.string().min(1), // JAG | PUL | GLOBAL
  position: z.string().min(1),     // legacy field
})

export const employeeUpdateSchema = employeeCreateSchema.partial().extend({
  active: z.boolean().optional(),
  // Allow null to clear optional fields (PATCH semantics: null = clear, undefined = don't change)
  phone: z.string().nullable().optional(),
  positionId: z.string().nullable().optional(),
  divisionId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
})

export const timeEntryCreateSchema = z.object({
  employeeId: z.string().min(1),
  date: z.coerce.date(),
  clockIn: z.coerce.date(),
  clockOut: z.coerce.date().optional(),
  projectId: z.string().optional(),
  taskName: z.string().optional(),
  source: z.enum(TIME_ENTRY_SOURCES).default('manual'),
  notes: z.string().optional(),
})

export const timeEntryBulkCreateSchema = z.object({
  employeeIds: z.array(z.string()).min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),   // "YYYY-MM-DD" plain string
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clockInUtc: z.string(),   // ISO UTC datetime from browser (local time → UTC)
  clockOutUtc: z.string(),
  skipWeekends: z.boolean().default(true),
  projectId: z.string().optional(),
})

export const breakSchema = z.object({
  timeEntryId: z.string().min(1),
  startTime: z.coerce.date(),
  endTime: z.coerce.date().optional(),
  type: z.enum(BREAK_TYPES).default('break'),
})

export const leaveRequestCreateSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isOnDemand: z.boolean().default(false),
  isRemoteWork: z.boolean().default(false),
  isDelegation: z.boolean().default(false),
  substituteId: z.string().optional(),
  notifySubstitute: z.boolean().default(false),
  note: z.string().optional(),
}).refine(d => d.endDate >= d.startDate, {
  message: 'endDate must be >= startDate',
  path: ['endDate'],
})

export const workScheduleCreateSchema = z.object({
  employeeId: z.string().min(1),
  date: z.coerce.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).default(30),
  type: z.enum(['regular', 'overtime', 'on-call']).default('regular'),
})

export const overtimeRequestSchema = z.object({
  employeeId: z.string().min(1),
  date: z.coerce.date(),
  minutes: z.number().int().min(1),
  reason: z.string().min(1),
})

export const leaveBalanceCorrectionSchema = z.object({
  totalDays: z.number().min(0).optional(),
  usedDays: z.number().min(0).optional(),
  carriedOver: z.number().min(0).optional(),
  reason: z.string().trim().min(3).max(1000),
}).strict().refine(
  (data) =>
    data.totalDays !== undefined ||
    data.usedDays !== undefined ||
    data.carriedOver !== undefined,
  { message: 'At least one leave balance field is required' }
)

const httpDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must use YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
  }, 'effectiveFrom must be a valid calendar date')
  .transform((value) => {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day))
  })

export const leaveEntitlementSaveSchema = z.object({
  mode: z.enum(['DAYS_20', 'DAYS_26', 'CUSTOM']),
  customAnnualDays: z.number().int().min(1).max(365).nullable().default(null),
  employmentFraction: z.number().gt(0).max(1),
  effectiveFrom: httpDateSchema,
  note: z.string().max(1000).nullable().optional(),
  year: z.number().int().min(2000).max(2100),
  preview: z.boolean().default(true),
  expectedCurrentTotalDays: z.number().nullable().optional(),
  expectedCurrentCarriedOver: z.number().min(0).nullable().optional(),
  expectedConfigVersion: z.string().min(1).nullable().optional(),
  expectedActiveConfigVersion: z.string().min(1).nullable().optional(),
  correctionReason: z.string().trim().min(3).max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'CUSTOM' && data.customAnnualDays === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'customAnnualDays is required for CUSTOM mode',
      path: ['customAnnualDays'],
    })
  }

  const targetYearEnd = new Date(Date.UTC(data.year, 11, 31, 23, 59, 59, 999))
  if (data.effectiveFrom > targetYearEnd) {
    ctx.addIssue({
      code: 'custom',
      message: 'effectiveFrom must be no later than the end of the target year',
      path: ['effectiveFrom'],
    })
  }

  if (!data.preview && data.expectedCurrentTotalDays === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'expectedCurrentTotalDays is required when applying',
      path: ['expectedCurrentTotalDays'],
    })
  }

  if (!data.preview && data.expectedCurrentCarriedOver === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'expectedCurrentCarriedOver is required when applying',
      path: ['expectedCurrentCarriedOver'],
    })
  }

  if (!data.preview && data.expectedConfigVersion === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'expectedConfigVersion is required when applying',
      path: ['expectedConfigVersion'],
    })
  }

  if (!data.preview && data.expectedActiveConfigVersion === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'expectedActiveConfigVersion is required when applying',
      path: ['expectedActiveConfigVersion'],
    })
  }
})
