import { Bricolage_Grotesque, Spline_Sans } from 'next/font/google'
import { MobileUpload } from '@/components/installations/client-form/mobile-upload'

const display = Bricolage_Grotesque({ variable: '--font-client-display', subsets: ['latin', 'latin-ext'], weight: ['700', '800'] })
const sans = Spline_Sans({ variable: '--font-client-sans', subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'] })

type Params = { params: Promise<{ code: string }> }
export const dynamic = 'force-dynamic'

export default async function MobileUploadPage({ params }: Params) {
  const { code } = await params
  return <div className={`${display.variable} ${sans.variable}`}><MobileUpload code={code} /></div>
}
