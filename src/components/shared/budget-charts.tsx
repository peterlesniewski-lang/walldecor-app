'use client'

import { Bar, BarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'

interface SubCategory {
  id: string
  name: string
  order: number
  categoryId: string
}

interface Category {
  id: string
  name: string
  subCategories: SubCategory[]
}

interface BudgetChartsProps {
  categories: Category[]
  entries: Record<string, number>  // key: `${subCategoryId}_${month}`
}

const MONTH_LABELS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

const chartConfig = {
  total: {
    label: 'Budżet',
    color: '#2A7D4F',
  },
} satisfies ChartConfig

export function BudgetCharts({ categories, entries }: BudgetChartsProps) {
  // Chart A: Monthly distribution — sum all entries per month
  const monthlyData = MONTH_LABELS.map((label, index) => {
    const month = index + 1
    const total = Object.entries(entries)
      .filter(([key]) => key.endsWith(`_${month}`))
      .reduce((sum, [, value]) => sum + value, 0)
    return { month: label, total }
  })

  // Chart B: Budget per category — sum all entries across all 12 months for each category
  const categoryData = categories.map((category) => {
    const subCategoryIds = new Set(category.subCategories.map((sc) => sc.id))
    const total = Object.entries(entries)
      .filter(([key]) => {
        const subCategoryId = key.split('_').slice(0, -1).join('_')
        return subCategoryIds.has(subCategoryId)
      })
      .reduce((sum, [, value]) => sum + value, 0)
    return { name: category.name, total }
  })

  const tooltipStyle = {
    borderRadius: '8px',
    border: 'none',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.07)',
    background: '#FFFFFF',
  }

  const tooltipContentStyle = {
    ...tooltipStyle,
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  }

  return (
    <div className="grid grid-cols-2 gap-5 mb-6">
      <div className="rounded-2xl bg-white p-5" style={{ boxShadow: 'var(--card-shadow)' }}>
        <p className="data-label mb-4">Miesięczny rozkład</p>
        <ChartContainer config={chartConfig} className="h-48">
          <BarChart data={monthlyData} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--wd-border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--wd-text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--wd-text-muted)' }} axisLine={false} tickLine={false} />
            <ChartTooltip
              contentStyle={tooltipContentStyle}
              content={
                <ChartTooltipContent
                  formatter={(value) => (value as number).toLocaleString('pl-PL')}
                />
              }
            />
            <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </div>

      <div className="rounded-2xl bg-white p-5" style={{ boxShadow: 'var(--card-shadow)' }}>
        <p className="data-label mb-4">Budżet per kategoria</p>
        <ChartContainer config={chartConfig} className="h-48">
          <BarChart data={categoryData} layout="vertical" barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--wd-border)" horizontal={false} />
            <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11, fill: 'var(--wd-text-muted)' }} axisLine={false} tickLine={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--wd-text-muted)' }} axisLine={false} tickLine={false} />
            <ChartTooltip
              contentStyle={tooltipContentStyle}
              content={
                <ChartTooltipContent
                  formatter={(value) => (value as number).toLocaleString('pl-PL')}
                />
              }
            />
            <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  )
}
