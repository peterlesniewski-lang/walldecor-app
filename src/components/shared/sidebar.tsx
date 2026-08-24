'use client'

import {
  LayoutDashboard,
  TrendingUp,
  Banknote,
  FileCheck2,
  Users,
  CalendarOff,
  Clock,
  Settings,
  ShieldAlert,
  BookOpen,
  ListChecks,
  ReceiptText,
  Target,
  ChartPie,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react'
import { NavItem } from './nav-item'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export type SidebarRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'INSTALLER'
export type NavSectionItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  roles?: SidebarRole[]
}

export const NAV_SECTIONS: Array<{ label: string | null; items: NavSectionItem[] }> = [
  {
    label: null,
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN'] },
    ],
  },
  {
    label: 'Kondycja firmy',
    items: [
      { href: '/finance', label: 'Wynik teraz', icon: LayoutDashboard, exact: true },
      { href: '/finance/actuals', label: 'Koszty', icon: TrendingUp, roles: ['ADMIN'] },
      { href: '/finance/ksef', label: 'KSeF Inbox', icon: FileCheck2, roles: ['ADMIN'] },
      { href: '/finance/cost-events', label: 'Zdarzenia kosztowe', icon: ReceiptText, roles: ['ADMIN'] },
      { href: '/finance/break-even', label: 'Break-even', icon: Target, roles: ['ADMIN'] },
      { href: '/finance/areas', label: 'Marża obszarów', icon: ChartPie, roles: ['ADMIN'] },
      { href: '/finance/revenue', label: 'Przychody', icon: Banknote, roles: ['ADMIN'] },
      { href: '/finance/alerts', label: 'Alerty', icon: ShieldAlert, roles: ['ADMIN'] },
    ],
  },
  {
    label: 'HR',
    items: [
      { href: '/hr/employees', label: 'Pracownicy', icon: Users },
      { href: '/hr/leave', label: 'Urlopy', icon: CalendarOff },
      { href: '/hr/time-tracking', label: 'Czas pracy', icon: Clock },
    ],
  },
  {
    label: 'Operacje',
    items: [
      { href: '/operations', label: 'Centrum', icon: ListChecks },
      { href: '/operations/procedures', label: 'Procedury', icon: BookOpen },
      { href: '/operations/runs', label: 'Wykonania', icon: ListChecks },
      { href: '/installations', label: 'Montaże', icon: ClipboardList },
    ],
  },
  {
    label: 'Wiedza',
    items: [
      { href: '/knowledge', label: 'Encyklopedia', icon: BookOpen },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings', label: 'Ustawienia', icon: Settings },
    ],
  },
]

export function visibleNavSections(userRole: SidebarRole) {
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => userRole === 'INSTALLER'
        ? item.href === '/installations'
        : !item.roles || item.roles.includes(userRole)),
    }))
    .filter((section) => section.items.length > 0)
}

export function SidebarNavigation({
  userRole,
  onNavigate,
  className,
}: {
  userRole: SidebarRole
  onNavigate?: () => void
  className?: string
}) {
  return (
    <nav aria-label="Główne obszary" className={cn('space-y-4 px-3', className)}>
      {visibleNavSections(userRole).map((section, i, sections) => (
        <div key={section.label ?? 'start'}>
          {section.label && (
            <p
              className="mb-1 px-3 uppercase"
              style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sidebar-text)', opacity: 0.65 }}
            >
              {section.label}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => (
                <NavItem key={item.href} {...item} onNavigate={onNavigate} />
            ))}
          </div>
          {i < sections.length - 1 && (
            <Separator className="mt-4" style={{ background: 'var(--sidebar-border)' }} />
          )}
        </div>
      ))}
    </nav>
  )
}

export function Sidebar({ userRole = 'EMPLOYEE' }: { userRole?: SidebarRole }) {
  return (
    <aside
      aria-label="Nawigacja główna"
      className="hidden h-screen w-64 shrink-0 flex-col border-r py-4 lg:flex"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <div className="px-4 pt-7 pb-5 mb-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
        <span
          className="text-lg tracking-wide"
          style={{ color: 'var(--wd-sand)', fontWeight: 800 }}
        >
          WallDecor
        </span>
        <p className="text-xs mt-0.5" style={{ color: 'var(--sidebar-text)', opacity: 0.6 }}>
          Panel zarządzania
        </p>
      </div>

      {/* Navigation */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNavigation userRole={userRole} />
      </div>
    </aside>
  )
}
