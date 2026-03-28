import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { BudgetThresholdPanel } from '@/components/alerts/budget-threshold-panel'
import { PaymentReminderPanel } from '@/components/alerts/payment-reminder-panel'
import { ShieldAlert } from 'lucide-react'

export default async function AlertsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  return (
    <div className="min-h-screen py-8 px-6" style={{ background: 'var(--wd-bg)' }}>
      {/* Page header */}
      <div className="mb-8 flex items-start gap-4">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
        >
          <ShieldAlert className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--wd-text-primary)', fontFamily: 'var(--font-display, inherit)' }}
          >
            Alerty i przypomnienia
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Konfiguruj progi budżetowe i terminy płatności. Alerty trafią do powiadomień administratorów.
          </p>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BudgetThresholdPanel />
        <PaymentReminderPanel />
      </div>
    </div>
  )
}
