import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompanyHealthView } from '@/components/shared/company-health-view'
import { buildCompanyHealth } from '@/lib/finance/company-health'

const health = buildCompanyHealth({
  year: 2026,
  currentMonth: 7,
  revenue: [{ costCenterId: 'JAG', month: 7, amount: 100_000 }],
  expenses: [{ costCenterId: 'JAG', month: 7, amount: 80_000 }],
})

describe('CompanyHealthView finance summaries', () => {
  it('shows admin-only KSeF and unpaid summaries beside warning amount', () => {
    render(
      <CompanyHealthView
        role="ADMIN"
        health={health}
        cashByCurrency={[]}
        ksefInboxCount={4}
        unpaidInvoiceAmount={1250}
        unclassifiedWarningAmount={350}
      />
    )

    expect(screen.getByRole('link', { name: /KSeF Inbox/ })).toBeTruthy()
    expect(screen.getByText('KSeF do obsługi')).toBeTruthy()
    expect(screen.getAllByText('4').length).toBeGreaterThan(0)
    expect(screen.getByText('Pozostało do zapłaty')).toBeTruthy()
    expect(screen.getByText('1250 PLN')).toBeTruthy()
    expect(screen.getByText('Koszty oczekujące')).toBeTruthy()
    expect(screen.getByText('350 PLN')).toBeTruthy()
  })

  it('hides the KSeF inbox link from managers', () => {
    render(
      <CompanyHealthView
        role="MANAGER"
        health={health}
        cashByCurrency={[]}
        ksefInboxCount={4}
        unpaidInvoiceAmount={1250}
        unclassifiedWarningAmount={350}
      />
    )

    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.getByRole('link', { name: /Zdarzenia kosztowe/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Break-even/ })).toBeTruthy()
    expect(screen.getByText('Koszty oczekujące')).toBeTruthy()
  })
})
