import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { listIntakeFormTemplateSummaries } from '@/lib/intake/forms/adminService'
import { IntakeFormsListClient } from './IntakeFormsListClient'

export const dynamic = 'force-dynamic'

export default async function IntakeFormsPage() {
  const claims = await getCachedClaims()
  if (!claims) notFound()
  const role = await getCachedUserRole(claims.id)
  if (role !== 'admin') notFound()

  let templates
  try {
    templates = await listIntakeFormTemplateSummaries()
  } catch {
    return (
      <div className="space-y-4">
        <PageHeader title="Intake forms" />
        <p role="alert" className="text-sm text-destructive">Could not load intake forms. Please try again.</p>
        <Button asChild variant="outline"><a href="/admin/settings/intake-forms">Retry loading intake forms</a></Button>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Intake forms" description="Build intake forms using approved fields and sections." />
      <IntakeFormsListClient initialTemplates={templates} />
    </div>
  )
}
