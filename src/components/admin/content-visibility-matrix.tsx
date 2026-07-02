'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'

type ResourceType = 'procedure' | 'template' | 'run'

interface VisibilityUser {
  id: string
  name: string
  email: string
  role: string
}

interface VisibilityResource {
  id: string
  label: string
  detail: string
  visibility: string
}

interface VisibilityGrant {
  resourceId: string
  userId: string
}

interface VisibilityResponse {
  resourceType: ResourceType
  users: VisibilityUser[]
  resources: VisibilityResource[]
  grants: VisibilityGrant[]
}

const TABS: Array<{ id: ResourceType; label: string }> = [
  { id: 'procedure', label: 'Procedury' },
  { id: 'template', label: 'Szablony' },
  { id: 'run', label: 'Wykonania' },
]

function grantKey(resourceId: string, userId: string) {
  return `${resourceId}:${userId}`
}

export function ContentVisibilityMatrix() {
  const [resourceType, setResourceType] = useState<ResourceType>('procedure')
  const [data, setData] = useState<VisibilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/content-visibility?resourceType=${resourceType}`)
      if (!response.ok) throw new Error('Nie udało się pobrać widoczności')
      setData(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd pobierania widoczności')
    } finally {
      setLoading(false)
    }
  }, [resourceType])

  useEffect(() => {
    load()
  }, [load])

  const grantSet = useMemo(() => {
    return new Set(data?.grants.map((grant) => grantKey(grant.resourceId, grant.userId)) ?? [])
  }, [data])

  async function toggle(resourceId: string, userId: string, visible: boolean) {
    const key = grantKey(resourceId, userId)
    setSavingKey(key)
    setError(null)
    try {
      const response = await fetch('/api/admin/content-visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceType, resourceId, userId, visible }),
      })
      if (!response.ok) throw new Error('Nie udało się zapisać widoczności')
      setData((current) => {
        if (!current) return current
        const grants = visible
          ? [...current.grants.filter((grant) => grantKey(grant.resourceId, grant.userId) !== key), { resourceId, userId }]
          : current.grants.filter((grant) => grantKey(grant.resourceId, grant.userId) !== key)
        return { ...current, grants }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd zapisu widoczności')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--wd-border)] bg-white p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setResourceType(tab.id)}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={
                resourceType === tab.id
                  ? { background: 'var(--wd-dark)', color: '#fff' }
                  : { color: 'var(--wd-text-muted)' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--wd-border)] bg-white px-3 py-2 text-sm font-medium"
          style={{ color: 'var(--wd-text-primary)' }}
        >
          <RefreshCw size={15} />
          Odśwież
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--wd-border)] bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            <Loader2 size={17} className="animate-spin" />
            Ładowanie widoczności
          </div>
        ) : !data || data.resources.length === 0 ? (
          <div className="py-16 text-center text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Brak pozycji w tej sekcji.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--wd-off-white)]">
              <tr>
                <th className="sticky left-0 z-10 min-w-72 bg-[var(--wd-off-white)] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--wd-text-muted)]">
                  Pozycja
                </th>
                {data.users.map((user) => (
                  <th key={user.id} className="min-w-40 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--wd-text-muted)]">
                    <span className="block normal-case text-[13px] font-semibold text-[var(--wd-text-primary)]">{user.name}</span>
                    <span className="block normal-case font-normal">{user.role}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--wd-border)]">
              {data.resources.map((resource) => (
                <tr key={resource.id}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <div className="font-medium text-[var(--wd-text-primary)]">{resource.label}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--wd-text-muted)]">
                      <span>{resource.detail}</span>
                      <span className="rounded bg-[var(--wd-off-white)] px-1.5 py-0.5">{resource.visibility}</span>
                    </div>
                  </td>
                  {data.users.map((user) => {
                    const key = grantKey(resource.id, user.id)
                    const checked = grantSet.has(key)
                    const saving = savingKey === key
                    return (
                      <td key={user.id} className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => toggle(resource.id, user.id, !checked)}
                          disabled={saving}
                          className="inline-flex h-9 w-16 items-center justify-center rounded-lg border text-sm font-medium transition-colors disabled:opacity-60"
                          title={checked ? 'Widoczne dla użytkownika' : 'Ukryte przed użytkownikiem'}
                          style={
                            checked
                              ? { background: '#DCFCE7', color: '#166534', borderColor: '#BBF7D0' }
                              : { background: '#F8F7F5', color: '#78716C', borderColor: 'var(--wd-border)' }
                          }
                        >
                          {saving ? <Loader2 size={16} className="animate-spin" /> : checked ? <Eye size={17} /> : <EyeOff size={17} />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
