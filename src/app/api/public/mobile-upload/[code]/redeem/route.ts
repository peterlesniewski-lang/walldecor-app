import { NextRequest, NextResponse } from 'next/server'
import { InstallationMediaAccessError, redeemMobileUploadHandoff } from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ code: string }> }
const noStore = { 'Cache-Control': 'no-store' }

export async function POST(_req: NextRequest, { params }: Params) {
  const { code } = await params
  try {
    const redeemed = await redeemMobileUploadHandoff(prisma, code)
    const response = NextResponse.json({ questionKey: redeemed.questionKey, expiresAt: redeemed.expiresAt.toISOString() }, { headers: noStore })
    response.cookies.set('installation_mobile_upload', redeemed.cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: redeemed.expiresAt,
    })
    return response
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono strony.' }, { status: 404, headers: noStore })
    throw error
  }
}
