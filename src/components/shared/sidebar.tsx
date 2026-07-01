'use client'

import {
  LayoutDashboard,
  TrendingUp,
  Banknote,
  Building2,
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
  type LucideIcon,
} from 'lucide-react'
import { NavItem } from './nav-item'
import { Separator } from '@/components/ui/separator'

type SidebarRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
type NavSectionItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  roles?: SidebarRole[]
}

const NAV_SECTIONS: Array<{ label: string | null; items: NavSectionItem[] }> = [
  {
    label: null,
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Kondycja firmy',
    items: [
      { href: '/finance', label: 'Wynik teraz', icon: LayoutDashboard, exact: true },
      { href: '/finance/actuals', label: 'Koszty', icon: TrendingUp },
      { href: '/finance/assumptions', label: 'Założenia kosztowe', icon: Building2 },
      { href: '/finance/ksef', label: 'KSeF Inbox', icon: FileCheck2, roles: ['ADMIN'] },
      { href: '/finance/cost-events', label: 'Zdarzenia kosztowe', icon: ReceiptText, roles: ['ADMIN', 'MANAGER'] },
      { href: '/finance/break-even', label: 'Break-even', icon: Target, roles: ['ADMIN', 'MANAGER'] },
      { href: '/finance/revenue', label: 'Przychody', icon: Banknote },
      { href: '/finance/alerts', label: 'Alerty', icon: ShieldAlert },
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

export function Sidebar({ userRole = 'EMPLOYEE' }: { userRole?: SidebarRole }) {
  return (
    <aside
      className="flex flex-col h-screen w-64 shrink-0 border-r py-4"
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
      <nav className="flex-1 px-3 space-y-4 overflow-y-auto">
        {NAV_SECTIONS.map((section, i) => (
          <div key={i}>
            {section.label && (
              <p
                className="px-3 mb-1 uppercase"
                style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sidebar-text)', opacity: 0.4 }}
              >
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.filter((item) => !item.roles || item.roles.includes(userRole)).map((item) => (
                <NavItem key={item.href} {...item} />
              ))}
            </div>
            {i < NAV_SECTIONS.length - 1 && (
              <Separator className="mt-4" style={{ background: 'var(--sidebar-border)' }} />
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
