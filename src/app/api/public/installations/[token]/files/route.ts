import { NextRequest, NextResponse } from 'next/server'
import { publicClientLinkNotFound } from '@/lib/installations/client-link'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import {
  createClientQuestionFile,
  InstallationMediaAccessError,
  InstallationMediaValidationError,
  listClientQuestionFiles,
} from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ token: string }> }
const noStore = { 'Cache-Control': 'no-store' }

function questionKeyFromRequest(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('questionKey')?.trim()
  if (!key || key.length > 160) throw new InstallationMediaAccessError()
  return key
}

function publicError(error: unknown) {
  if (error instanceof InstallationMediaAccessError) return publicClientLinkNotFound()
  if (error instanceof InstallationMediaValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
  throw error
}

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    return NextResponse.json({ files: await listClientQuestionFiles(prisma, token, questionKeyFromRequest(req)) }, { headers: noStore })
  } catch (error) {
    return publicError(error)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const form = await req.formData()
    const questionKey = form.get('questionKey')
    const file = form.get('file')
    if (typeof questionKey !== 'string' || !questionKey.trim() || !file || typeof file !== 'object' || !('arrayBuffer' in file) || !('name' in file) || !('type' in file)) {
      return NextResponse.json({ error: 'Wybierz plik oraz pytanie, którego dotyczy.' }, { status: 400, headers: noStore })
    }
    const upload = await createClientQuestionFile(prisma, token, {
      questionKey: questionKey.trim(),
      filename: String(file.name),
      contentType: String(file.type),
      bytes: new Uint8Array(await file.arrayBuffer()),
    }, privateMediaClientFromEnvironment())
    return NextResponse.json({ file: upload }, { status: 201, headers: noStore })
  } catch (error) {
    return publicError(error)
  }
}
