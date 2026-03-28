import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { HrSettingsForm } from './hr-settings-form'

const HR_DEFAULTS = {
  hr_saturday_workable: 'true',
  hr_standard_clock_in: '11:00',
  hr_standard_clock_out: '19:00',
  hr_overtime_threshold_minutes: '480',
}

export default async function HrSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/settings')

  const dbSettings = await prisma.appSetting.findMany({
    where: { key: { startsWith: 'hr_' } },
  })

  const values = { ...HR_DEFAULTS }
  for (const s of dbSettings) {
    if (s.key in values) {
      values[s.key as keyof typeof values] = s.value
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Ustawienia — Moduł HR
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Konfiguracja godzin pracy, sobót i progu nadgodzin
        </p>
      </div>

      <HrSettingsForm initialValues={values} />
    </div>
  )
}
