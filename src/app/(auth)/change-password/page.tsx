import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ChangePasswordForm } from '@/components/shared/change-password-form'

export default async function ChangePasswordPage() {
  const session = await getServerSession(authOptions)
  if (!session) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--wd-off-white)' }}>
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--wd-dark)' }}>
            WallDecor
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Zmiana hasła
          </p>
        </div>
        <ChangePasswordForm forced={Boolean(session.user.mustChangePassword)} />
      </div>
    </div>
  )
}
