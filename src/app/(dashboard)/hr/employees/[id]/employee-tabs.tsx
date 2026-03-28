'use client'

import { useState } from 'react'

interface Tab {
  id: string
  label: string
  content: React.ReactNode
}

interface EmployeeTabsProps {
  tabs: Tab[]
  defaultTab?: string
}

export function EmployeeTabs({ tabs, defaultTab }: EmployeeTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id)

  const active = tabs.find((t) => t.id === activeTab)

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-[var(--wd-border)] mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab.id === activeTab
                ? 'border-[var(--wd-dark)] text-[var(--wd-dark)]'
                : 'border-transparent text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>{active?.content}</div>
    </div>
  )
}
