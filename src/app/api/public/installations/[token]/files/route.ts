import { NextRequest, NextResponse } from 'next/server'
import { publicClientLinkNotFound } from '@/lib/installations/client-link'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { InstallationMultipartError, parseInstallationMultipart } from '@/lib/installation-media/multipart'
import { publicInstallationFileDto } from '@/lib/installation-media/public-dto'
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
  if (error instanceof InstallationMultipartError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore })
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
    const { fields, file } = await parseInstallationMultipart(req, { allowedFields: ['questionKey'] })
    const questionKey = fields.questionKey
    if (!questionKey?.trim()) {
      return NextResponse.json({ error: 'Wybierz plik oraz pytanie, którego dotyczy.' }, { status: 400, headers: noStore })
    }
    const upload = await createClientQuestionFile(prisma, token, {
      questionKey: questionKey.trim(),
      filename: file.filename,
      contentType: file.contentType,
      bytes: file.bytes,
    }, privateMediaClientFromEnvironment())
    return NextResponse.json({ file: publicInstallationFileDto(upload) }, { status: 201, headers: noStore })
  } catch (error) {
    return publicError(error)
  }
}
