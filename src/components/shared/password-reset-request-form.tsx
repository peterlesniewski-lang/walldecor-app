'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  PasswordResetRequestSchema,
  type PasswordResetRequestInput,
} from '@/lib/validations/auth'

export function PasswordResetRequestForm() {
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestSchema),
  })

  async function onSubmit(data: PasswordResetRequestInput) {
    setMessage(null)
    setError(null)

    const response = await fetch('/api/account/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: data.email }),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      setError(body?.error ?? 'Nie udało się wysłać hasła tymczasowego.')
      return
    }

    setMessage(body?.message ?? 'Sprawdź skrzynkę email.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Reset hasła</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {message && (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="jan.kowalski@walldecor.pl"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
            style={{ background: 'var(--wd-dark)', color: 'var(--wd-sand)' }}
          >
            {isSubmitting ? 'Wysyłam...' : 'Wyślij hasło tymczasowe'}
          </Button>

          <div className="text-center text-sm">
            <Link href="/login" className="underline-offset-4 hover:underline">
              Wróć do logowania
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
