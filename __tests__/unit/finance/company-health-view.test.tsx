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
        cashByCurrency={[{ currency: 'PLN', amount: 123_000 }]}
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
    expect(screen.getByText('Kasa')).toBeTruthy()
    expect(screen.getByText('123 000 PLN')).toBeTruthy()
    expect(screen.getByText('Koszty oczekujące')).toBeTruthy()
    expect(screen.getByText('350 PLN')).toBeTruthy()
  })

  it('shows only aggregate finance cards to managers', () => {
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
    expect(screen.queryByRole('link', { name: /Koszty/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Zdarzenia kosztowe/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Break-even/ })).toBeNull()
    expect(screen.queryByText('Koszty oczekujące')).toBeNull()
    expect(screen.queryByText('Kasa')).toBeNull()
    expect(screen.queryByText('Kasa i alerty')).toBeNull()
  })

  it('shows only aggregate finance cards to employees', () => {
    render(
      <CompanyHealthView
        role="EMPLOYEE"
        health={health}
        cashByCurrency={[]}
        ksefInboxCount={4}
        unpaidInvoiceAmount={1250}
        unclassifiedWarningAmount={350}
      />
    )

    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.queryByRole('link', { name: /Koszty/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Zdarzenia kosztowe/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Break-even/ })).toBeNull()
    expect(screen.queryByText('Koszty oczekujące')).toBeNull()
    expect(screen.queryByText('Kasa')).toBeNull()
    expect(screen.queryByText('Kasa i alerty')).toBeNull()
  })
})
