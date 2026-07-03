import { NextRequest, NextResponse } from 'next/server'
import { PasswordResetRequestSchema } from '@/lib/validations/auth'
import {
  PASSWORD_RESET_ACCEPTED_MESSAGE,
  requestPasswordReset,
} from '@/lib/accounts/password-reset'
import { isEmailDeliveryConfigured } from '@/lib/email/outbound-email'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const parsed = PasswordResetRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json(
      { error: 'Reset hasła przez email nie jest skonfigurowany.' },
      { status: 503 }
    )
  }

  await requestPasswordReset({
    email: parsed.data.email,
    appUrl: resolveAppUrl(req),
  })

  return NextResponse.json({ message: PASSWORD_RESET_ACCEPTED_MESSAGE })
}

function resolveAppUrl(req: NextRequest) {
  return process.env.NEXTAUTH_URL ?? req.nextUrl.origin
}
