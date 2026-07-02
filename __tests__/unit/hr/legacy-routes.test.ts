import { describe, expect, it, vi } from 'vitest'
import HRPage from '@/app/(dashboard)/hr/page'
import LeavesPage from '@/app/(dashboard)/hr/leaves/page'
import TimesheetsPage from '@/app/(dashboard)/hr/timesheets/page'
import { redirect } from 'next/navigation'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

describe('legacy HR routes', () => {
  it('redirects /hr to the active employees module', () => {
    expect(() => HRPage()).toThrow('redirect:/hr/employees')
    expect(redirect).toHaveBeenCalledWith('/hr/employees')
  })

  it('redirects /hr/leaves to the active leave module', () => {
    expect(() => LeavesPage()).toThrow('redirect:/hr/leave')
    expect(redirect).toHaveBeenCalledWith('/hr/leave')
  })

  it('redirects /hr/timesheets to the active time tracking module', () => {
    expect(() => TimesheetsPage()).toThrow('redirect:/hr/time-tracking')
    expect(redirect).toHaveBeenCalledWith('/hr/time-tracking')
  })
})
