'use client'

import { useRouter } from 'next/navigation'
import { RevenuePlanGrid } from '@/components/shared/revenue-plan-grid'
import { RevenueActualsGrid } from '@/components/shared/revenue-actuals-grid'

interface RevenueTabs {
  planEntries: Record<string, number>
  actualEntries: Record<string, number>
  year: number
  costCenterId: string
  activeTab: 'plan' | 'actuals'
  canEditPlan: boolean
  canEditActuals: boolean
}

export function RevenueTabs({
  planEntries,
  actualEntries,
  year,
  costCenterId,
  activeTab,
  canEditPlan,
  canEditActuals,
}: RevenueTabs) {
  const router = useRouter()

  const navigate = (tab: 'plan' | 'actuals', yr = year, cc = costCenterId) => {
    const base = `/finance/revenue?year=${yr}&costCenterId=${cc}`
    router.push(tab === 'actuals' ? `${base}&tab=actuals` : base)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Przychody
          </h1>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(activeTab, year - 1)} className="p-1 hover:bg-gray-100 rounded">
              ‹
            </button>
            <span className="font-medium px-2">{year}</span>
            <button onClick={() => navigate(activeTab, year + 1)} className="p-1 hover:bg-gray-100 rounded">
              ›
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          {['GLOBAL', 'JAG', 'PUL'].map((cc) => (
            <button
              key={cc}
              onClick={() => navigate(activeTab, year, cc)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                costCenterId === cc
                  ? 'bg-[#E4DCD1] text-gray-800'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {cc}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {(['plan', 'actuals'] as const).map((t) => (
          <button
            key={t}
            onClick={() => navigate(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t
                ? 'border-[#E4DCD1] text-gray-800'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t === 'plan' ? 'Plan sprzedaży' : 'Wykonanie'}
          </button>
        ))}
      </div>

      {activeTab === 'plan' ? (
        <RevenuePlanGrid
          key={`plan-${year}-${costCenterId}`}
          initialEntries={planEntries}
          year={year}
          costCenterId={costCenterId}
          editable={canEditPlan}
        />
      ) : (
        <RevenueActualsGrid
          key={`actuals-${year}-${costCenterId}`}
          planEntries={planEntries}
          initialActuals={actualEntries}
          year={year}
          costCenterId={costCenterId}
          editable={canEditActuals}
        />
      )}
    </div>
  )
}
