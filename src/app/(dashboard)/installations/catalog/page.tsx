import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageInstallationCatalog } from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { listInstallationCatalog, listInstallationFormTemplates } from '@/lib/installations/catalog-service'
import { CatalogManager } from '@/components/installations/catalog-manager'
import { TemplateBuilder } from '@/components/installations/template-builder'

export default async function InstallationCatalogPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!canManageInstallationCatalog(await installationViewerFromSession(session))) redirect('/installations')
  const [catalog, templates] = await Promise.all([
    listInstallationCatalog(prisma),
    listInstallationFormTemplates(prisma),
  ])
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <p className="data-label">Konfiguracja montaży</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Katalog i formularze</h1>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--wd-text-muted)' }}>Zmiany są od razu zapisywane w bazie. Rodzaje prac są płaskimi kategoriami wybieranymi przy budowie zakresu, a archiwizacja zachowuje historyczne zakresy i ich migawki.</p>
      </div>
      <CatalogManager initialCatalog={catalog} />
      <TemplateBuilder initialTemplates={templates} />
    </div>
  )
}
