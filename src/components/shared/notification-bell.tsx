'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  CheckCircle,
  XCircle,
  Calendar,
  TrendingUp,
  Check,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  isRead: boolean
  createdAt: string
}

interface NotificationsResponse {
  notifications: Notification[]
  unreadCount: number
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'leave_approved':
      return <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
    case 'leave_rejected':
      return <XCircle className="h-4 w-4 shrink-0 text-red-500" />
    case 'leave_request':
      return <Calendar className="h-4 w-4 shrink-0 text-blue-500" />
    case 'overtime':
      return <TrendingUp className="h-4 w-4 shrink-0 text-orange-500" />
    default:
      return <Bell className="h-4 w-4 shrink-0 text-gray-400" />
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMin < 1) return 'przed chwilą'
  if (diffMin < 60) return `${diffMin} min temu`
  if (diffHours < 24) return `${diffHours}h temu`
  if (diffDays === 1) return 'wczoraj'
  return `${diffDays} dni temu`
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<NotificationsResponse>({ notifications: [], unreadCount: 0 })
  const [loading, setLoading] = useState(false)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const json: NotificationsResponse = await res.json()
        setData(json)
      }
    } catch {
      // silently fail
    }
  }, [])

  // Initial fetch + 30s polling
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Refresh when dropdown opens
  useEffect(() => {
    if (open) fetchNotifications()
  }, [open, fetchNotifications])

  const handleMarkAllRead = async () => {
    setLoading(true)
    try {
      await fetch('/api/notifications/read-all', { method: 'PATCH' })
      setData((prev) => ({
        notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }))
    } finally {
      setLoading(false)
    }
  }

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await fetch(`/api/notifications/${notification.id}/read`, { method: 'PATCH' })
      setData((prev) => ({
        notifications: prev.notifications.map((n) =>
          n.id === notification.id ? { ...n, isRead: true } : n
        ),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      }))
    }
    setOpen(false)
    if (notification.link) {
      router.push(notification.link)
    }
  }

  const badgeCount = data.unreadCount > 9 ? '9+' : data.unreadCount.toString()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex items-center justify-center h-8 w-8 rounded-lg transition-colors hover:bg-[var(--wd-off-white)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wd-sand)]"
          aria-label="Powiadomienia"
        >
          <Bell
            className="h-[18px] w-[18px] transition-colors"
            style={{ color: data.unreadCount > 0 ? 'var(--wd-text-primary)' : 'var(--wd-text-muted)' }}
          />
          {data.unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-[3px] leading-none">
              {badgeCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="p-0 w-[380px] border border-[var(--wd-border)] rounded-xl shadow-lg overflow-hidden"
        style={{ background: 'var(--wd-white)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--wd-text-primary)' }}>
            Powiadomienia
            {data.unreadCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1">
                {data.unreadCount}
              </span>
            )}
          </span>
          {data.unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={loading}
              className="flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
              style={{ color: 'var(--wd-text-muted)' }}
            >
              <Check className="h-3 w-3" />
              Oznacz wszystkie
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-[360px] overflow-y-auto">
          {data.notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Bell className="h-8 w-8" style={{ color: 'var(--wd-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                Brak powiadomień
              </p>
            </div>
          ) : (
            data.notifications.map((notification, index) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={cn(
                  'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-[var(--wd-off-white)] focus:outline-none',
                  index !== 0 && 'border-t',
                  !notification.isRead && 'bg-[var(--wd-off-white)]'
                )}
                style={{ borderColor: 'var(--wd-border)' }}
              >
                <div className="mt-0.5 shrink-0">
                  {getTypeIcon(notification.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        'text-xs leading-snug truncate',
                        notification.isRead ? 'font-normal' : 'font-semibold'
                      )}
                      style={{
                        color: notification.isRead ? 'var(--wd-text-muted)' : 'var(--wd-text-primary)',
                      }}
                    >
                      {notification.title}
                    </p>
                    <span
                      className="text-[10px] shrink-0 mt-px"
                      style={{ color: 'var(--wd-text-muted)' }}
                    >
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </div>
                  <p
                    className="text-xs mt-0.5 line-clamp-2 leading-snug"
                    style={{ color: 'var(--wd-text-muted)' }}
                  >
                    {notification.message}
                  </p>
                </div>
                {!notification.isRead && (
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t px-4 py-2.5"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7 font-medium"
            style={{ color: 'var(--wd-text-muted)' }}
            onClick={() => {
              setOpen(false)
              router.push('/notifications')
            }}
          >
            Zobacz wszystkie powiadomienia
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
