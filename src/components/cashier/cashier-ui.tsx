'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { CashierCommand } from '@/lib/cashier/contracts'
import styles from './cashier.module.css'

export type CommandHandler = (command: CashierCommand) => Promise<boolean>

// Intent: showroom staff finish a counted cash sheet; admin inspects the same sheet.
// Palette/surfaces: existing warm paper/sand/graphite tokens; slight card shadow.
// Type: existing Jakarta, tabular DM Mono for money. Spacing: 4px scale.
export function CashField({ label, value, onChange, required = false, disabled = false, date = false }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean; date?: boolean
}) {
  return <label className={styles.field}><span>{label}</span><Input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled} inputMode={date ? 'numeric' : 'decimal'} placeholder={date ? 'RRRR-MM-DD' : '0,00'} pattern={date ? '\\d{4}-\\d{2}-\\d{2}' : undefined} className={styles.moneyInput} /></label>
}

export function CashChoice({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; disabled?: boolean
}) {
  return <div className={styles.field}><span>{label}</span><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-label={label} disabled={disabled} className={styles.choice}>{options.find((option) => option.value === value)?.label ?? 'Wybierz…'}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={value} onValueChange={onChange}>{options.map((option) => <DropdownMenuRadioItem value={option.value} key={option.value}>{option.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></div>
}

export function CashNote({ label, value, onChange, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean }) {
  return <label className={styles.field}><span>{label}</span><textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} maxLength={2000} rows={2} className={styles.textarea} /></label>
}

export function CashCheck({ children, checked, onChange }: { children: ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.check}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> <span>{children}</span></label>
}

export function CashError({ error }: { error: string }) { return error ? <p role="alert" className={styles.error}>{error}</p> : null }
