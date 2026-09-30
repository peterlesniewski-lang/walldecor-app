import { clientDisplay as display, clientSans as sans } from '@/app/fonts'
import { MobileUpload } from '@/components/installations/client-form/mobile-upload'

type Params = { params: Promise<{ code: string }> }
export const dynamic = 'force-dynamic'

export default async function MobileUploadPage({ params }: Params) {
  const { code } = await params
  return <div className={`${display.variable} ${sans.variable}`}><MobileUpload code={code} /></div>
}
