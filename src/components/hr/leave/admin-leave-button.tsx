'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LeaveRequestForm } from './leave-request-form'

interface AdminLeaveButtonProps {
  onSuccess?: () => void
}

export function AdminLeaveButton({ onSuccess }: AdminLeaveButtonProps) {
  const [open, setOpen] = useState(false)

  const handleSuccess = () => {
    setOpen(false)
    onSuccess?.()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-[#1E1E1E] text-white hover:bg-[#2E2E2E] transition-colors"
      >
        <Plus size={15} />
        Dodaj urlop
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-lg rounded-xl border-[#E8E6E3] p-0"
          style={{ background: 'white', overflow: 'visible' }}
        >
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-[#E8E6E3]">
            <DialogTitle className="text-base font-semibold text-[var(--wd-text-primary)]">
              Dodaj urlop — widok admina
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-5">
            <LeaveRequestForm
              isAdmin={true}
              onSuccess={handleSuccess}
              onCancel={() => setOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
