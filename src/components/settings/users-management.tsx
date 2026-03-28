'use client'

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmployeeSelect } from '@/components/hr/employees/employee-select'
import {
  MoreHorizontal,
  Plus,
  KeyRound,
  ShieldCheck,
  Ban,
  CheckCircle2,
  Trash2,
  UserCog,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

interface UserEmployee {
  firstName: string
  lastName: string
  position: string
  divisionId: string | null
}

interface UserRecord {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  createdAt: string | Date
  employeeId: string | null
  employee: UserEmployee | null
}

interface UsersManagementProps {
  users: UserRecord[]
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  if (role === 'ADMIN') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-[#1E1E1E] text-white">
        ADMIN
      </span>
    )
  }
  if (role === 'MANAGER') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-amber-100 text-amber-800">
        MANAGER
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-stone-100 text-stone-700">
      EMPLOYEE
    </span>
  )
}

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isActive ? 'text-emerald-700' : 'text-red-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {isActive ? 'Aktywny' : 'Zablokowany'}
    </span>
  )
}

// ─── Temp Password Dialog ─────────────────────────────────────────────────────

function TempPasswordDialog({
  open,
  onClose,
  password,
  title,
}: {
  open: boolean
  onClose: () => void
  password: string
  title: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-[var(--wd-text-muted)]">
            Hasło tymczasowe — przekaż je użytkownikowi bezpiecznym kanałem.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2.5 bg-[var(--wd-surface-2)] rounded-lg font-mono text-base tracking-widest text-[var(--wd-dark)] border border-[var(--wd-border)]">
              {password}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 px-3 py-2.5 text-xs font-semibold rounded-lg border border-[var(--wd-border)] bg-white hover:bg-[var(--wd-surface-2)] transition-colors"
            >
              {copied ? 'Skopiowano!' : 'Kopiuj'}
            </button>
          </div>
          <Button className="w-full" onClick={onClose}>
            Gotowe
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Change Role Dialog ───────────────────────────────────────────────────────

function ChangeRoleDialog({
  open,
  onClose,
  user,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  user: UserRecord
  onSuccess: (updated: UserRecord) => void
}) {
  const [role, setRole] = useState<Role>(user.role as Role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Błąd zapisu')
        return
      }
      const updated = await res.json()
      onSuccess(updated)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Zmień rolę — {user.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Rola</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)]"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="MANAGER">MANAGER</option>
              <option value="EMPLOYEE">EMPLOYEE</option>
            </select>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Anuluj
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'Zapisuję…' : 'Zapisz'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Add User Dialog ──────────────────────────────────────────────────────────

function AddUserDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: (user: UserRecord) => void
}) {
  const [form, setForm] = useState({ name: '', email: '', role: 'EMPLOYEE' as Role })
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, employeeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Błąd tworzenia konta')
        return
      }
      setTempPassword(data.temporaryPassword)
      setShowPassword(true)
      onSuccess(data)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setForm({ name: '', email: '', role: 'EMPLOYEE' })
    setEmployeeId(undefined)
    setError('')
    setTempPassword('')
    setShowPassword(false)
    onClose()
  }

  if (showPassword) {
    return (
      <TempPasswordDialog
        open={open}
        onClose={handleClose}
        password={tempPassword}
        title="Konto utworzone"
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj użytkownika</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="u-name">Imię i nazwisko</Label>
            <Input
              id="u-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Jan Kowalski"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-email">Email</Label>
            <Input
              id="u-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jan@walldecor.pl"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-role">Rola</Label>
            <select
              id="u-role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)]"
            >
              <option value="EMPLOYEE">EMPLOYEE</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Powiąż z pracownikiem (opcjonalnie)</Label>
            <EmployeeSelect
              value={employeeId}
              onChange={(v) => setEmployeeId(v)}
              placeholder="Wybierz pracownika…"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
              Anuluj
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Tworzę…' : 'Utwórz konto'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── User Row Actions ─────────────────────────────────────────────────────────

function UserRowActions({
  user,
  onUpdate,
  onDelete,
}: {
  user: UserRecord
  onUpdate: (updated: UserRecord) => void
  onDelete: (id: string) => void
}) {
  const [showChangeRole, setShowChangeRole] = useState(false)
  const [showTempPassword, setShowTempPassword] = useState(false)
  const [tempPassword, setTempPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const handleToggleActive = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      if (res.ok) {
        const updated = await res.json()
        onUpdate(updated)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleResetPassword = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setTempPassword(data.temporaryPassword)
        setShowTempPassword(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Usunąć konto użytkownika ${user.name}? Tej operacji nie można cofnąć.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDelete(user.id)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-lg text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] hover:bg-[var(--wd-surface-2)] transition-colors disabled:opacity-40"
            disabled={busy}
            aria-label="Akcje"
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setShowChangeRole(true)}>
            <UserCog size={14} className="mr-2 shrink-0" />
            Zmień rolę
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleToggleActive}>
            {user.isActive ? (
              <>
                <Ban size={14} className="mr-2 shrink-0 text-red-500" />
                <span className="text-red-600">Zablokuj konto</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} className="mr-2 shrink-0 text-emerald-600" />
                <span className="text-emerald-700">Odblokuj konto</span>
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleResetPassword}>
            <KeyRound size={14} className="mr-2 shrink-0" />
            Resetuj hasło
          </DropdownMenuItem>
          {!user.employeeId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDelete} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                <Trash2 size={14} className="mr-2 shrink-0" />
                Usuń użytkownika
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showChangeRole && (
        <ChangeRoleDialog
          open={showChangeRole}
          onClose={() => setShowChangeRole(false)}
          user={user}
          onSuccess={onUpdate}
        />
      )}

      {showTempPassword && (
        <TempPasswordDialog
          open={showTempPassword}
          onClose={() => setShowTempPassword(false)}
          password={tempPassword}
          title="Hasło zresetowane"
        />
      )}
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UsersManagement({ users: initialUsers }: UsersManagementProps) {
  const [users, setUsers] = useState<UserRecord[]>(initialUsers)
  const [showAdd, setShowAdd] = useState(false)

  const handleUpdate = (updated: UserRecord) => {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
  }

  const handleDelete = (id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id))
  }

  const handleAddSuccess = (newUser: UserRecord) => {
    setUsers((prev) => [...prev, newUser].sort((a, b) => a.name.localeCompare(b.name, 'pl')))
  }

  return (
    <>
      {/* Header with action button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--wd-text-muted)]">
          {users.length} {users.length === 1 ? 'użytkownik' : users.length < 5 ? 'użytkownicy' : 'użytkowników'}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-80"
          style={{ background: 'var(--wd-dark)', color: '#fff' }}
        >
          <Plus size={15} />
          Dodaj użytkownika
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[var(--wd-border)] overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--wd-border)] bg-[var(--wd-surface-2)]">
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide uppercase text-[var(--wd-text-muted)]">
                Użytkownik
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide uppercase text-[var(--wd-text-muted)]">
                Rola
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide uppercase text-[var(--wd-text-muted)] hidden md:table-cell">
                Pracownik
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide uppercase text-[var(--wd-text-muted)]">
                Status
              </th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--wd-border)]">
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--wd-text-muted)]">
                  Brak użytkowników
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-[var(--wd-surface-2)]/50 transition-colors">
                {/* User info */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: 'var(--wd-dark)' }}
                      aria-hidden="true"
                    >
                      {user.name
                        .split(' ')
                        .slice(0, 2)
                        .map((p) => p[0])
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--wd-text-primary)] truncate">{user.name}</div>
                      <div className="text-xs text-[var(--wd-text-muted)] truncate">{user.email}</div>
                    </div>
                  </div>
                </td>
                {/* Role */}
                <td className="px-4 py-3">
                  <RoleBadge role={user.role} />
                </td>
                {/* Employee link */}
                <td className="px-4 py-3 hidden md:table-cell">
                  {user.employee ? (
                    <div>
                      <div className="font-medium text-[var(--wd-text-primary)] text-xs">
                        {user.employee.firstName} {user.employee.lastName}
                      </div>
                      <div className="text-[11px] text-[var(--wd-text-muted)] flex items-center gap-1">
                        {user.employee.position}
                        {user.employee.divisionId && (
                          <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-[var(--wd-sand)] text-[var(--wd-dark)]">
                            {user.employee.divisionId}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--wd-text-muted)] italic">—</span>
                  )}
                </td>
                {/* Status */}
                <td className="px-4 py-3">
                  <StatusBadge isActive={user.isActive} />
                </td>
                {/* Actions */}
                <td className="px-4 py-3 text-right">
                  <UserRowActions user={user} onUpdate={handleUpdate} onDelete={handleDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add user dialog */}
      <AddUserDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={handleAddSuccess}
      />
    </>
  )
}
