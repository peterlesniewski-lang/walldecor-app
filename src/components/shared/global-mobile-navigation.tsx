'use client'

import { MobileNavigationDialog } from './mobile-navigation-dialog'
import {
  SidebarNavigation,
  type SidebarRole,
} from './sidebar'

export function GlobalMobileNavigation({ userRole }: { userRole: SidebarRole }) {
  return (
    <MobileNavigationDialog
      triggerLabel="Otwórz menu główne"
      title="WallDecor"
      description="Nawigacja główna panelu zarządzania"
      className="lg:hidden"
    >
      {(close) => (
        <SidebarNavigation userRole={userRole} onNavigate={close} className="py-4" />
      )}
    </MobileNavigationDialog>
  )
}
