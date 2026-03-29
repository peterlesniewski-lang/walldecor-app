import { z } from 'zod'
import { EMPLOYMENT_TYPES, LEAVE_STATUSES, TIME_ENTRY_STATUSES, TIME_ENTRY_SOURCES, BREAK_TYPES } from './constants'

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
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/), // "08:00"
  clockOut: z.string().regex(/^\d{2}:\d{2}$/),
  skipWeekends: z.boolean().default(true),
  projectId: z.string().optional(),
  // Browser timezone offset in minutes: (UTC - local), e.g. -120 for UTC+2
  tzOffsetMinutes: z.number().int().optional().default(0),
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

export const leaveBalanceUpdateSchema = z.object({
  totalDays: z.number().min(0).optional(),
  usedDays: z.number().min(0).optional(),
  carriedOver: z.number().min(0).optional(),
})
