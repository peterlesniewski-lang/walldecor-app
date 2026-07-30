'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Users,
  Clock,
  Calendar,
  ChevronDown,
  ChevronRight,
  Network,
  AlarmClock,
  CalendarDays,
  BarChart2,
  CalendarRange,
  FileText,
  CheckSquare,
  Settings2,
  TrendingUp,
  PieChart,
} from 'lucide-react'
import { MobileNavigationDialog } from '@/components/shared/mobile-navigation-dialog'

export type HrRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

interface HrSidebarProps {
  userRole: HrRole
}

interface NavLeaf {
  href: string
  label: string
  icon: React.ElementType
  roles?: HrRole[]
}

interface NavGroup {
  id: string
  label: string
  icon: React.ElementType
  children: NavLeaf[]
}

interface NavSection {
  type: 'leaf'
  items: NavLeaf[]
}

type NavEntry = NavGroup | NavSection

export const HR_NAV: NavEntry[] = [
  {
    type: 'leaf',
    items: [
      { href: '/hr/employees', label: 'Lista pracowników', icon: Users },
      { href: '/hr/employees/structure', label: 'Struktura', icon: Network },
    ],
  },
  {
    id: 'time',
    label: 'Czas pracy',
    icon: Clock,
    children: [
      { href: '/hr/time-tracking', label: 'Dashboard', icon: Clock },
      { href: '/hr/time-tracking/clock', label: 'Rejestracja', icon: AlarmClock },
      { href: '/hr/time-tracking/schedule', label: 'Grafik', icon: CalendarDays },
      { href: '/hr/time-tracking/periods', label: 'Okresy', icon: CalendarRange, roles: ['ADMIN', 'MANAGER'] },
      { href: '/hr/time-tracking/overtime', label: 'Nadgodziny', icon: TrendingUp },
      { href: '/hr/time-tracking/reports', label: 'Raporty', icon: BarChart2 },
    ],
  },
  {
    id: 'leave',
    label: 'Urlopy',
    icon: Calendar,
    children: [
      { href: '/hr/leave', label: 'Kalendarz', icon: Calendar },
      { href: '/hr/leave/requests', label: 'Wnioski', icon: FileText },
      { href: '/hr/leave/types', label: 'Typy', icon: Settings2, roles: ['ADMIN'] },
      { href: '/hr/leave/balances', label: 'Salda', icon: PieChart, roles: ['ADMIN', 'MANAGER'] },
      { href: '/hr/leave/approval', label: 'Akceptacja', icon: CheckSquare, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
]

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'id' in entry
}

// ─── Single nav leaf link ────────────────────────────────────────────────────

function HrNavLink({
  item,
  indent = false,
  onNavigate,
}: {
  item: NavLeaf
  indent?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  // exact match for index routes, startsWith for nested
  const isActive =
    pathname === item.href ||
    (item.href !== '/hr/employees' &&
      item.href !== '/hr/time-tracking' &&
      item.href !== '/hr/leave' &&
      pathname.startsWith(item.href + '/'))

  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className="flex min-h-11 items-center gap-2.5 rounded-sm py-1.5 text-[13px] font-medium transition-all duration-150 xl:min-h-0"
      style={
        isActive
          ? {
              background: 'rgba(228, 220, 209, 0.15)',
              color: '#FFFFFF',
              borderLeft: '2px solid var(--wd-sand)',
              paddingLeft: indent ? '2rem' : '0.75rem',
              paddingRight: '0.75rem',
            }
          : {
              color: 'var(--sidebar-text)',
              borderLeft: '2px solid transparent',
              paddingLeft: indent ? '2rem' : '0.75rem',
              paddingRight: '0.75rem',
            }
      }
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          e.currentTarget.style.color = '#FFFFFF'
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--sidebar-text)'
        }
      }}
    >
      <Icon size={15} className="shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}

// ─── Collapsible group ───────────────────────────────────────────────────────

function HrNavGroup({
  group,
  userRole,
  onNavigate,
  idPrefix,
}: {
  group: NavGroup
  userRole: HrRole
  onNavigate?: () => void
  idPrefix: string
}) {
  const pathname = usePathname()
  const visibleChildren = group.children.filter(
    (c) => !c.roles || c.roles.includes(userRole)
  )
  const isAnyChildActive = visibleChildren.some(
    (c) => pathname === c.href || pathname.startsWith(c.href + '/')
  )
  const [open, setOpen] = useState(isAnyChildActive)
  const Icon = group.icon
  const Chevron = open ? ChevronDown : ChevronRight
  const regionId = `${idPrefix}-group-${group.id}`

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between rounded-sm px-3 py-1.5 text-[13px] font-medium transition-all duration-150 xl:min-h-0"
        style={{
          color: isAnyChildActive ? '#FFFFFF' : 'var(--sidebar-text)',
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          e.currentTarget.style.color = '#FFFFFF'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = isAnyChildActive ? '#FFFFFF' : 'var(--sidebar-text)'
        }}
      >
        <span className="flex items-center gap-2.5">
          <Icon size={15} className="shrink-0" />
          {group.label}
        </span>
        <Chevron size={13} className="shrink-0 opacity-60" />
      </button>

      <div
        id={regionId}
        role="region"
        aria-label={`${group.label} - podmenu`}
        hidden={!open}
        className="mt-0.5 space-y-0.5"
      >
        {visibleChildren.map((child) => (
          <HrNavLink key={child.href} item={child} indent onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

// ─── Main sidebar ────────────────────────────────────────────────────────────

export function HrNavigation({
  userRole,
  onNavigate,
  idPrefix,
}: {
  userRole: HrRole
  onNavigate?: () => void
  idPrefix: string
}) {
  return (
    <nav aria-label="Obszary HR" className="space-y-1 px-2 py-3">
      <div>
        <p
          className="mb-1 px-3"
          style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--sidebar-text)', opacity: 0.7 }}
        >
          Pracownicy
        </p>
        <div className="space-y-0.5">
          {(HR_NAV[0] as NavSection).items.map((item) => (
            <HrNavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      </div>

      <div className="pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />

      {HR_NAV.slice(1).map((entry) => {
        if (!isGroup(entry)) return null
        return (
          <HrNavGroup
            key={entry.id}
            group={entry}
            userRole={userRole}
            onNavigate={onNavigate}
            idPrefix={idPrefix}
          />
        )
      })}
    </nav>
  )
}

export function HrMobileNavigation({ userRole }: HrSidebarProps) {
  return (
    <MobileNavigationDialog
      triggerLabel="Otwórz menu HR"
      title="Menu HR"
      description="Nawigacja modułu HR"
      className="xl:hidden"
    >
      {(close) => (
        <HrNavigation
          userRole={userRole}
          onNavigate={close}
          idPrefix="hr-mobile-nav"
        />
      )}
    </MobileNavigationDialog>
  )
}

export function HrSidebar({ userRole }: HrSidebarProps) {
  return (
    <aside
      aria-label="Nawigacja HR"
      className="hidden w-52 shrink-0 flex-col overflow-y-auto border-r xl:flex"
      style={{
        background: '#252525',
        borderColor: 'var(--sidebar-border)',
        minHeight: '100%',
      }}
    >
      {/* Section header */}
      <div
        className="px-4 pt-5 pb-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <p
          className="data-label"
          style={{ color: '#8A8582', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}
        >
          Moduł HR
        </p>
      </div>

      {/* Navigation */}
      <HrNavigation userRole={userRole} idPrefix="hr-desktop-nav" />
    </aside>
  )
}
