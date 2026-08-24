'use client'

import { useSession } from 'next-auth/react'

interface RoleGuardProps {
  roles: ('ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'INSTALLER')[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Renders `children` only when the current user's role is in the `roles` array.
 * Falls back to `fallback` (or null) when the user lacks the required role.
 * Returns null while the session is still loading.
 */
export function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const { data: session, status } = useSession()

  if (status === 'loading') return null

  const userRole = session?.user?.role

  if (!userRole || !roles.includes(userRole)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
