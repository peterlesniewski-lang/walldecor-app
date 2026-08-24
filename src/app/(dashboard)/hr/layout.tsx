import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { HrMobileNavigation, HrSidebar } from '@/components/hr/hr-sidebar'

type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role as Role

  return (
    // -m-6 lg:-m-8 cancels the parent <main>'s padding so sidebar stretches edge-to-edge
    <div className="flex -m-6 lg:-m-8 min-h-full">
      <HrSidebar userRole={role} />
      {/* Re-add padding inside the content area */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6 lg:p-8">
        <div className="mb-4 xl:hidden">
          <HrMobileNavigation userRole={role} />
        </div>
        {children}
      </div>
    </div>
  )
}
