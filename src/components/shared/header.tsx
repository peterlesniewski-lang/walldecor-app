import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Menedżer',
  EMPLOYEE: 'Pracownik',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export async function Header() {
  const session = await getServerSession(authOptions)
  const user = session?.user

  return (
    <header
      className="flex items-center justify-between h-14 px-6 border-b shrink-0"
      style={{ background: 'var(--wd-white)', borderColor: 'var(--border)' }}
    >
      <div />

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 outline-none">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-none">{user.name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                {ROLE_LABELS[user.role] ?? user.role}
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
              {ROLE_LABELS[user.role] ?? user.role}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SignOutButton />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
