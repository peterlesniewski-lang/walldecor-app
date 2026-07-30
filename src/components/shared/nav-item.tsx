'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  href: string
  label: string
  icon: LucideIcon
  collapsed?: boolean
  exact?: boolean
  onNavigate?: () => void
}

export function NavItem({
  href,
  label,
  icon: Icon,
  collapsed,
  exact,
  onNavigate,
}: NavItemProps) {
  const pathname = usePathname()
  const isActive = exact ? pathname === href : pathname === href || (href !== '/' && pathname.startsWith(href + '/'))

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className="flex min-h-11 items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors lg:min-h-0"
      style={
        isActive
          ? {
              background: 'var(--sidebar-active-bg)',
              color: 'var(--sidebar-active-text)',
              borderLeft: '2px solid #E4DCD1',
              paddingLeft: '0.625rem',
              paddingRight: '0.75rem',
            }
          : {
              color: 'var(--sidebar-text)',
              borderLeft: '2px solid transparent',
              paddingLeft: '0.625rem',
              paddingRight: '0.75rem',
            }
      }
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--sidebar-hover-bg)'
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
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}
