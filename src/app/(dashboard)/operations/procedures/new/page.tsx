import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ArticleEditor } from '@/components/wikipedia/ArticleEditor'

const PROCEDURE_TEMPLATE = `## Cel

## Kiedy wykonać

## Kroki
1.

## Kryterium ukończenia

## Linki i materiały
`

export default async function NewOperationProcedurePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/operations/procedures')

  return (
    <ArticleEditor
      heading="Nowa procedura"
      backHref="/operations/procedures"
      successHref="/operations/procedures"
      lockType
      initialData={{
        title: '',
        content: PROCEDURE_TEMPLATE,
        category: 'processes',
        visibility: 'public',
        type: 'procedure',
        tags: ['operations'],
        authorNote: '',
      }}
    />
  )
}
