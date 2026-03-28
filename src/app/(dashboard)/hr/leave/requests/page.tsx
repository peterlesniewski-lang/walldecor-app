import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { LeaveRequestsView } from '@/components/hr/leave/leave-requests-view'

export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  const employeeId = session.user.employeeId ?? ''

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      <LeaveRequestsView employeeId={employeeId} role={role} />
    </div>
  )
}
