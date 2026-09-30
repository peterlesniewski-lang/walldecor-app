import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { parsePayrollMonth, payrollMonthKey } from '@/lib/payroll/period'
import { PayrollMonthView } from '@/components/hr/payroll/payroll-month-view'

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/hr')

  const { month } = await searchParams
  const today = getWarsawBusinessDate()
  const maxMonth = payrollMonthKey({ year: today.year, month: today.month })
  const requested = parsePayrollMonth(month)
  const initialMonth = requested && payrollMonthKey(requested) <= maxMonth ? payrollMonthKey(requested) : maxMonth

  return <PayrollMonthView initialMonth={initialMonth} maxMonth={maxMonth} />
}
