'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  href: string
  label: string
  icon: LucideIcon
  collapsed?: boolean
}

export function NavItem({ href, label, icon: Icon, collapsed }: NavItemProps) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
      style={
        isActive
          ? {
              background: 'var(--sidebar-active-bg)',
              color: 'var(--sidebar-active-text)',
            }
          : {
              color: 'var(--sidebar-text)',
            }
      }
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--sidebar-hover-bg)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}
