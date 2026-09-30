'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LeaveRequestForm } from './leave-request-form'

interface LeaveRequestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  employeeId?: string
  employeeName?: string
  startDate?: string
  endDate?: string
}

export function LeaveRequestDialog({
  open,
  onOpenChange,
  onSuccess,
  employeeId,
  employeeName,
  startDate,
  endDate,
}: LeaveRequestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg rounded-xl border-[#E8E6E3] p-0"
        style={{ background: 'white', overflow: 'visible' }}
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[#E8E6E3]">
          <DialogTitle className="text-base font-semibold text-[var(--wd-text-primary)]">
            {employeeName ? `Dodaj urlop — ${employeeName}` : 'Dodaj urlop — widok admina'}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5">
          <LeaveRequestForm
            isAdmin={true}
            employeeId={employeeId}
            initialStartDate={startDate}
            initialEndDate={endDate}
            onSuccess={onSuccess}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
