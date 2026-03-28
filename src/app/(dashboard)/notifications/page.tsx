import { Suspense } from 'react'
import { NotificationList } from './notification-list'

export const metadata = {
  title: 'Powiadomienia — WallDecor',
}

export default function NotificationsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: 'var(--wd-text-primary)' }}
        >
          Powiadomienia
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--wd-text-muted)' }}>
          Wszystkie powiadomienia dla Twojego konta
        </p>
      </div>

      <Suspense fallback={<NotificationListSkeleton />}>
        <NotificationList />
      </Suspense>
    </div>
  )
}

function NotificationListSkeleton() {
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
          <div className="h-8 w-8 rounded-full bg-gray-100 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-gray-100 rounded w-2/3" />
            <div className="h-3 bg-gray-100 rounded w-full" />
          </div>
          <div className="h-3 bg-gray-100 rounded w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}
