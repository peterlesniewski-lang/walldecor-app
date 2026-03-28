import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CsvCostsPanel } from '@/components/shared/csv-costs-panel'
import { CsvRevenuePanel } from '@/components/shared/csv-revenue-panel'
import { CsvColumnMapper } from '@/components/shared/csv-column-mapper'
import { CashThresholdsForm } from '@/components/shared/cash-thresholds-form'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const userRole = session.user.role ?? 'EMPLOYEE'

  return (
    <div className="space-y-10 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Ustawienia
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Import i eksport danych finansowych w formacie CSV.
        </p>
      </div>

      <section className="space-y-4">
        <div className="border-b border-[var(--wd-border)] pb-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Import / Eksport — Koszty
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Plan budżetowy i wykonanie kosztów</p>
        </div>
        <CsvCostsPanel userRole={userRole} />
      </section>

      <section className="space-y-4">
        <div className="border-b border-[var(--wd-border)] pb-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Import / Eksport — Przychody
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Plan sprzedaży i wykonanie przychodów</p>
        </div>
        <CsvRevenuePanel userRole={userRole} />
      </section>

      <section className="space-y-4">
        <div className="border-b border-[var(--wd-border)] pb-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Import z mapowaniem kolumn
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Wgraj dowolny plik CSV i przypisz jego kolumny do pól systemu
          </p>
        </div>
        <CsvColumnMapper userRole={userRole} />
      </section>

      {userRole === 'ADMIN' && (
        <section className="space-y-4">
          <div className="border-b border-[var(--wd-border)] pb-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
              Cash Flow — progi stanu finansów
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Kwoty netto (gotówka − zobowiązania) definiujące ocenę stanu finansów firmy
            </p>
          </div>
          <CashThresholdsForm />
        </section>
      )}

      {userRole === 'ADMIN' && (
        <section className="space-y-4">
          <div className="border-b border-[var(--wd-border)] pb-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
              Moduł HR
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Godziny pracy, soboty, próg nadgodzin
            </p>
          </div>
          <Link
            href="/settings/hr"
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            Konfiguruj ustawienia HR →
          </Link>
        </section>
      )}

      {userRole === 'ADMIN' && (
        <section className="space-y-4">
          <div className="border-b border-[var(--wd-border)] pb-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--wd-dark)' }}>
              Użytkownicy i dostęp
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Zarządzaj kontami użytkowników, rolami i blokadami dostępu
            </p>
          </div>
          <Link
            href="/settings/users"
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            Zarządzaj użytkownikami →
          </Link>
        </section>
      )}
    </div>
  )
}
