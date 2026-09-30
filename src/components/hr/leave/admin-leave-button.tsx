'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { LeaveRequestDialog } from './leave-request-dialog'

interface AdminLeaveButtonProps {
  onSuccess?: () => void
}

export function AdminLeaveButton({ onSuccess }: AdminLeaveButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const handleSuccess = () => {
    setOpen(false)
    // Re-run the server page so the calendar receives the new request.
    router.refresh()
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

      <LeaveRequestDialog open={open} onOpenChange={setOpen} onSuccess={handleSuccess} />
    </>
  )
}
