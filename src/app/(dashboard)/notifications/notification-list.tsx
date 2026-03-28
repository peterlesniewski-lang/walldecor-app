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
  ArrowRight,
} from 'lucide-react'
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
      return (
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-emerald-50">
          <CheckCircle className="h-[18px] w-[18px] text-emerald-500" />
        </div>
      )
    case 'leave_rejected':
      return (
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-red-50">
          <XCircle className="h-[18px] w-[18px] text-red-500" />
        </div>
      )
    case 'leave_request':
      return (
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-blue-50">
          <Calendar className="h-[18px] w-[18px] text-blue-500" />
        </div>
      )
    case 'overtime':
      return (
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-orange-50">
          <TrendingUp className="h-[18px] w-[18px] text-orange-500" />
        </div>
      )
    default:
      return (
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-gray-100">
          <Bell className="h-[18px] w-[18px] text-gray-400" />
        </div>
      )
  }
}

function formatDateTime(dateStr: string): string {
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
  if (diffDays < 7) return `${diffDays} dni temu`

  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function NotificationList() {
  const router = useRouter()
  const [data, setData] = useState<NotificationsResponse>({ notifications: [], unreadCount: 0 })
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const json: NotificationsResponse = await res.json()
        setData(json)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    try {
      await fetch('/api/notifications/read-all', { method: 'PATCH' })
      setData((prev) => ({
        notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }))
    } finally {
      setMarkingAll(false)
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
    if (notification.link) {
      router.push(notification.link)
    }
  }

  if (loading) {
    return (
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-white)' }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 px-5 py-4 border-b last:border-0 animate-pulse"
            style={{ borderColor: 'var(--wd-border)' }}
          >
            <div className="h-9 w-9 rounded-full bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (data.notifications.length === 0) {
    return (
      <div
        className="rounded-xl border flex flex-col items-center justify-center py-16 gap-3"
        style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-white)' }}
      >
        <div className="flex items-center justify-center h-14 w-14 rounded-full bg-gray-100">
          <Bell className="h-6 w-6 text-gray-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--wd-text-primary)' }}>
            Brak powiadomień
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--wd-text-muted)' }}>
            Tutaj pojawią się powiadomienia o urlopach i innych zdarzeniach
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
            {data.unreadCount} nieprzeczytanych
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="h-7 text-xs gap-1"
            style={{ color: 'var(--wd-text-muted)' }}
          >
            <Check className="h-3 w-3" />
            Oznacz wszystkie jako przeczytane
          </Button>
        </div>
      )}

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-white)' }}
      >
        {data.notifications.map((notification, index) => (
          <div
            key={notification.id}
            className={cn(
              'flex items-start gap-4 px-5 py-4 transition-colors',
              index !== 0 && 'border-t',
              !notification.isRead && 'bg-[var(--wd-off-white)]',
              notification.link && 'cursor-pointer hover:bg-[var(--wd-off-white)]'
            )}
            style={{ borderColor: 'var(--wd-border)' }}
            onClick={() => handleNotificationClick(notification)}
          >
            <div className="shrink-0 mt-0.5">
              {getTypeIcon(notification.type)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <p
                  className={cn('text-sm leading-snug', !notification.isRead ? 'font-semibold' : 'font-medium')}
                  style={{ color: 'var(--wd-text-primary)' }}
                >
                  {notification.title}
                </p>
                <span
                  className="text-xs shrink-0 mt-px"
                  style={{ color: 'var(--wd-text-muted)' }}
                >
                  {formatDateTime(notification.createdAt)}
                </span>
              </div>
              <p
                className="text-sm mt-1 leading-relaxed"
                style={{ color: 'var(--wd-text-muted)' }}
              >
                {notification.message}
              </p>
            </div>

            <div className="shrink-0 flex items-center gap-2 mt-0.5">
              {!notification.isRead && (
                <div className="h-2 w-2 rounded-full bg-blue-500" />
              )}
              {notification.link && (
                <ArrowRight className="h-4 w-4" style={{ color: 'var(--wd-text-muted)' }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
