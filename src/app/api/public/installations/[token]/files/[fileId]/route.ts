import { NextRequest, NextResponse } from 'next/server'
import { publicClientLinkNotFound } from '@/lib/installations/client-link'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { getClientQuestionFile, InstallationMediaAccessError } from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ token: string; fileId: string }> }

function publicQuestionKey(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('questionKey')?.trim()
  if (!key || key.length > 160) throw new InstallationMediaAccessError()
  return key
}

export async function GET(req: NextRequest, { params }: Params) {
  const { token, fileId } = await params
  try {
    const file = await getClientQuestionFile(prisma, token, publicQuestionKey(req), fileId)
    const remote = await privateMediaClientFromEnvironment().download(file.id)
    return new NextResponse(remote.body, { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return publicClientLinkNotFound()
    throw error
  }
}
