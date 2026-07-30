'use client'

import { useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface MobileNavigationDialogProps {
  triggerLabel: string
  title: string
  description: string
  className: string
  children: (close: () => void) => ReactNode
}

export function MobileNavigationDialog({
  triggerLabel,
  title,
  description,
  className,
  children,
}: MobileNavigationDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            'grid h-11 w-11 shrink-0 place-items-center rounded-md text-[var(--wd-text-primary)] transition-colors hover:bg-[var(--wd-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-dark)] focus-visible:ring-offset-1',
            className
          )}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </DialogTrigger>

      <DialogContent
        className="!flex h-[100dvh] !max-w-none flex-col gap-0 overflow-hidden rounded-none border-y-0 border-l-0 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-0 text-white !animate-none sm:rounded-none"
        style={{
          left: 0,
          top: 0,
          width: 'min(20rem, calc(100vw - 2rem))',
          maxWidth: 'none',
          transform: 'none',
        }}
      >
        <DialogHeader className="border-b border-white/10 px-4 py-5 pr-12 text-left">
          <DialogTitle className="text-base font-bold text-white">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {children(() => setOpen(false))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
