import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClockWidget } from '@/components/hr/time-tracking/clock-widget'
import { getWeekRange } from '@/lib/hr/utils'

export default async function ClockPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const employee = await prisma.employee.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (!employee) {
    return (
      <div className="p-6 lg:p-8 max-w-lg">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Rejestracja czasu pracy
        </h1>
        <div className="mt-6 rounded-xl px-6 py-10 text-center" style={{ background: '#fff', border: '1px solid var(--wd-border)' }}>
          <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Twoje konto nie jest powiązane z kartą pracownika.
            Skontaktuj się z administratorem.
          </p>
        </div>
      </div>
    )
  }

  // Weekly stats
  const { start, end } = getWeekRange(new Date())
  const weekEntries = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      date: { gte: start, lte: end },
    },
    include: { breaks: true },
  })

  const weekTotalMinutes = weekEntries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0)
  const weekBreakMinutes = weekEntries.reduce((sum, e) => sum + (e.breakMinutes ?? 0), 0)

  // Today's totals (for partial/in-progress entry we'll rely on client-side calc)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayEntry = weekEntries.find((e) => {
    const d = new Date(e.date)
    d.setHours(0, 0, 0, 0)
    return d.getTime() === today.getTime()
  })

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Rejestracja czasu pracy
        </h1>
        <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
          Clock in / out i przerwy
        </p>
      </div>

      <div className="max-w-md">
        <ClockWidget
          employeeId={employee.id}
          weekStats={{
            totalMinutes: weekTotalMinutes,
            breakMinutes: weekBreakMinutes,
            todayMinutes: todayEntry?.totalMinutes ?? 0,
            todayBreakMinutes: todayEntry?.breakMinutes ?? 0,
          }}
        />
      </div>
    </div>
  )
}
