'use client'

import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Users,
  CalendarOff,
  Clock,
  Settings,
} from 'lucide-react'
import { NavItem } from './nav-item'
import { Separator } from '@/components/ui/separator'

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Finanse',
    items: [
      { href: '/finance/budget', label: 'Budżet', icon: TrendingUp },
      { href: '/finance/actuals', label: 'Wykonanie', icon: BarChart3 },
    ],
  },
  {
    label: 'HR',
    items: [
      { href: '/hr/employees', label: 'Pracownicy', icon: Users },
      { href: '/hr/leaves', label: 'Urlopy', icon: CalendarOff },
      { href: '/hr/timesheets', label: 'Czas pracy', icon: Clock },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings', label: 'Ustawienia', icon: Settings },
    ],
  },
]

export function Sidebar() {
  return (
    <aside
      className="flex flex-col h-screen w-64 shrink-0 border-r py-4"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <div className="px-4 mb-6">
        <span
          className="text-base font-semibold tracking-wide"
          style={{ color: 'var(--wd-sand)' }}
        >
          WallDecor
        </span>
        <p className="text-xs mt-0.5" style={{ color: 'var(--sidebar-text)' }}>
          Panel zarządzania
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-4 overflow-y-auto">
        {NAV_SECTIONS.map((section, i) => (
          <div key={i}>
            {section.label && (
              <p
                className="px-3 mb-1 text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--sidebar-text)', opacity: 0.5 }}
              >
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
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
