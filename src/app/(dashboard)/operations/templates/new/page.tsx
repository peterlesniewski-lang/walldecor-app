import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getTemplateEditorOptions } from '@/lib/operations/queries'
import { TemplateForm } from '@/components/operations/template-form'

export default async function NewOperationTemplatePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/operations/templates')

  const options = await getTemplateEditorOptions()

  return <TemplateForm mode="create" {...options} />
}
