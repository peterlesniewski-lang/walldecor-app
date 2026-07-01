import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ChangePasswordSchema } from '@/lib/validations/auth'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = ChangePasswordSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Konto jest niedostępne.' }, { status: 403 })
  }

  const currentPasswordMatches = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash
  )
  if (!currentPasswordMatches) {
    return NextResponse.json({ error: 'Aktualne hasło jest nieprawidłowe.' }, { status: 400 })
  }

  const samePassword = await bcrypt.compare(parsed.data.newPassword, user.passwordHash)
  if (samePassword) {
    return NextResponse.json({ error: 'Nowe hasło musi różnić się od aktualnego.' }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })

  return NextResponse.json({ success: true })
}
