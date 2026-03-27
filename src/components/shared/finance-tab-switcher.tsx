'use client'

import { useRouter } from 'next/navigation'

interface Props {
  activeTab: 'plan' | 'actuals'
  year: number
  costCenterId: string
}

export function FinanceTabSwitcher({ activeTab, year, costCenterId }: Props) {
  const router = useRouter()

  const tabs = [
    {
      id: 'plan' as const,
      label: 'Plan budżetowy',
      href: `/finance?year=${year}&costCenterId=${costCenterId}`,
    },
    {
      id: 'actuals' as const,
      label: 'Wykonanie kosztów',
      href: `/finance?tab=actuals&year=${year}&costCenterId=${costCenterId}`,
    },
  ]

  return (
    <div className="flex border-b border-gray-200 mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => router.push(t.href)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === t.id
              ? 'border-[#E4DCD1] text-gray-800'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
