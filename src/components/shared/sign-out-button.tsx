'use client'

import { signOut } from 'next-auth/react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { LogOut } from 'lucide-react'

export function SignOutButton() {
  return (
    <DropdownMenuItem
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="cursor-pointer text-red-600 focus:text-red-600"
    >
      <LogOut size={14} className="mr-2" />
      Wyloguj się
    </DropdownMenuItem>
  )
}
