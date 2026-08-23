import { NextRequest, NextResponse } from 'next/server'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { InstallationMediaAccessError, InstallationMediaValidationError, uploadMobileHandoffFile } from '@/lib/installation-media/service'
import { prisma } from '@/lib/prisma'

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  try {
    const cookie = req.cookies.get('installation_mobile_upload')?.value
    if (!cookie) throw new InstallationMediaAccessError()
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !('name' in file) || !('type' in file)) {
      return NextResponse.json({ error: 'Wybierz plik do dodania.' }, { status: 400, headers: noStore })
    }
    const upload = await uploadMobileHandoffFile(prisma, cookie, {
      filename: String(file.name),
      contentType: String(file.type),
      bytes: new Uint8Array(await file.arrayBuffer()),
    }, privateMediaClientFromEnvironment())
    return NextResponse.json({ file: upload }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono strony.' }, { status: 404, headers: noStore })
    if (error instanceof InstallationMediaValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400, headers: noStore })
    throw error
  }
}
