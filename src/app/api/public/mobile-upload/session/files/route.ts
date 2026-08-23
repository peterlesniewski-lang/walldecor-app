import { NextRequest, NextResponse } from 'next/server'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { InstallationMultipartError, parseInstallationMultipart } from '@/lib/installation-media/multipart'
import { publicInstallationFileDto } from '@/lib/installation-media/public-dto'
import { InstallationMediaAccessError, InstallationMediaValidationError, uploadMobileHandoffFile } from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  try {
    const cookie = req.cookies.get('installation_mobile_upload')?.value
    if (!cookie) throw new InstallationMediaAccessError()
    const { file } = await parseInstallationMultipart(req, { allowedFields: [] })
    const upload = await uploadMobileHandoffFile(prisma, cookie, {
      filename: file.filename,
      contentType: file.contentType,
      bytes: file.bytes,
    }, privateMediaClientFromEnvironment())
    return NextResponse.json({ file: publicInstallationFileDto(upload) }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono strony.' }, { status: 404, headers: noStore })
    if (error instanceof InstallationMediaValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
    if (error instanceof InstallationMultipartError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore })
    throw error
  }
}
