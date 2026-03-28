import { prisma } from '@/lib/prisma'

export interface HrSettings {
  saturdayWorkable: boolean
  standardClockIn: string
  standardClockOut: string
  overtimeThresholdMinutes: number
}

export async function getHrSettings(): Promise<HrSettings> {
  const settings = await prisma.appSetting.findMany({
    where: { key: { startsWith: 'hr_' } },
  })

  return {
    saturdayWorkable: settings.find((s) => s.key === 'hr_saturday_workable')?.value !== 'false',
    standardClockIn: settings.find((s) => s.key === 'hr_standard_clock_in')?.value ?? '11:00',
    standardClockOut: settings.find((s) => s.key === 'hr_standard_clock_out')?.value ?? '19:00',
    overtimeThresholdMinutes: parseInt(
      settings.find((s) => s.key === 'hr_overtime_threshold_minutes')?.value ?? '480'
    ),
  }
}
