import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { OrgStructureClient } from './org-structure-client'

export default async function EmployeesStructurePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/hr/employees')

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">Struktura organizacyjna</h1>
        <p className="text-sm mt-0.5 text-[var(--wd-text-muted)]">
          Hierarchia oddziałów, działów i stanowisk
        </p>
      </div>
      <OrgStructureClient />
    </div>
  )
}
