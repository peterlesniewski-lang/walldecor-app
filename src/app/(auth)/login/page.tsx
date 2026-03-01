import { LoginForm } from '@/components/shared/login-form'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--wd-off-white)' }}>
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--wd-dark)' }}>
            WallDecor
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Panel zarządzania
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
