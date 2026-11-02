'use client'

import { useRouter } from 'next/navigation'
import { RevenueActualsGrid, type RevenueActualEntry } from '@/components/shared/revenue-actuals-grid'
import { Button } from '@/components/ui/button'
import { SubiektRevenuePanel } from '@/components/shared/subiekt-revenue-panel'
import type { SubiektRevenueView } from '@/lib/finance/subiekt-revenue'
import styles from './revenue-ui.module.css'

interface RevenueTabsProps {
  entries: RevenueActualEntry[]
  year: number
  costCenterId: string
  editable: boolean
  /** Only ADMIN may read from the bridge and apply amounts; the page already redirects other roles. */
  isAdmin: boolean
  subiekt: SubiektRevenueView
}

export function RevenueTabs({ entries, year, costCenterId, editable, isAdmin, subiekt }: RevenueTabsProps) {
  const router = useRouter()
  const navigate = (nextYear: number, center = costCenterId) => {
    router.push(`/finance/revenue?year=${nextYear}&costCenterId=${center}`)
  }

  return (
    <div className={`${styles.theme} ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Rzeczywiste obroty</p>
          <h1 className={styles.title}>Przychody</h1>
          <p className={styles.description}>
            Kwoty brutto po korektach, narastająco od początku miesiąca. Kolejny zapis zastępuje poprzednią kwotę.
          </p>
        </div>
        <div className={styles.yearPicker}>
          <Button type="button" aria-label="Poprzedni rok" disabled={year <= 2020} onClick={() => navigate(year - 1)} className={styles.segment}>‹</Button>
          <span className={styles.year}>{year}</span>
          <Button type="button" aria-label="Następny rok" disabled={year >= 2100} onClick={() => navigate(year + 1)} className={styles.segment}>›</Button>
        </div>
      </header>

      <nav aria-label="Salon przychodów" className={styles.tabs}>
        {(['GLOBAL', 'JAG', 'PUL'] as const).map((center) => (
          <Button
            type="button" key={center} aria-pressed={costCenterId === center}
            onClick={() => navigate(year, center)}
            className={styles.tab}
          >
            {center === 'GLOBAL' ? 'Cała firma' : center === 'JAG' ? 'Jagiellońska' : 'Puławska'}
          </Button>
        ))}
      </nav>

      {costCenterId === 'GLOBAL' && (
        <p className={styles.notice}>
          Podsumowanie obu salonów. Aby wpisać lub skorygować obrót, wybierz Jagiellońską albo Puławską.
        </p>
      )}

      <SubiektRevenuePanel view={subiekt} year={year} canRefresh={isAdmin} />

      <RevenueActualsGrid
        key={`${year}:${costCenterId}`} initialEntries={entries} year={year} costCenterId={costCenterId} editable={editable}
        subiektCells={subiekt.configured ? subiekt.cells : null}
      />
    </div>
  )
}
