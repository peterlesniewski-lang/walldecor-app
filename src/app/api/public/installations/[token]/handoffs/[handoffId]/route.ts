import { NextRequest, NextResponse } from 'next/server'
import { publicClientLinkNotFound } from '@/lib/installations/client-link'
import { InstallationMediaAccessError, revokeMobileUploadHandoff } from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ token: string; handoffId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { token, handoffId } = await params
  try {
    await revokeMobileUploadHandoff(prisma, handoffId, token)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return publicClientLinkNotFound()
    throw error
  }
}
