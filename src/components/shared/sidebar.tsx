'use client'

import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Banknote,
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
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Finanse',
    items: [
      { href: '/finance/revenue', label: 'Przychody', icon: Banknote },
      { href: '/finance', label: 'Budżet', icon: TrendingUp },
      { href: '/finance/actuals', label: 'Wykonanie', icon: BarChart3 },
    ],
  },
  {
    label: 'HR',
    items: [
      { href: '/hr', label: 'Pracownicy', icon: Users },
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
