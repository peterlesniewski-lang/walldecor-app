import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutButton } from './sign-out-button'
import { NotificationBell } from './notification-bell'
import { GlobalMobileNavigation } from './global-mobile-navigation'
import type { SidebarRole } from './sidebar'

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Menedżer',
  EMPLOYEE: 'Pracownik',
  INSTALLER: 'Instalator',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

interface HeaderUser {
  name?: string | null
  email?: string | null
  role?: string | null
}

function normalizeRole(role: string | null | undefined): SidebarRole {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'INSTALLER' ? role : 'EMPLOYEE'
}

export function Header({ user }: { user: HeaderUser }) {
  const userRole = normalizeRole(user.role)

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b px-3 sm:px-6"
      style={{ background: 'var(--wd-white)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center">
        <GlobalMobileNavigation userRole={userRole} />
      </div>

      <div className="flex items-center gap-3">
        {userRole !== 'INSTALLER' && <NotificationBell />}

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 outline-none">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-none">{user.name}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {ROLE_LABELS[userRole]}
              </p>
            </div>
            <Avatar className="h-8 w-8">
              <AvatarFallback
                className="text-xs font-medium"
                style={{ background: 'var(--wd-sand)', color: 'var(--wd-dark)' }}
              >
                {getInitials(user.name ?? 'U')}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {user.email}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {ROLE_LABELS[userRole]}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SignOutButton />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
