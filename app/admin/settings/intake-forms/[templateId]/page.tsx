import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getIntakeFormEditorSnapshot } from '@/lib/intake/forms/adminService'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import { IntakeFormEditorClient } from './IntakeFormEditorClient'

export const dynamic = 'force-dynamic'

export default async function IntakeFormEditorPage({ params }: { params: Promise<{ templateId: string }> }) {
  const claims = await getCachedClaims()
  if (!claims) notFound()
  if (await getCachedUserRole(claims.id) !== 'admin') notFound()
  const { templateId } = await params
  if (!z.string().uuid().safeParse(templateId).success) notFound()
  let snapshot
  try {
    snapshot = await getIntakeFormEditorSnapshot(templateId)
  } catch {
    return <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Intake form</h1>
      <p role="alert">Could not load this intake form. Please try again.</p>
      <Button asChild variant="outline"><a href={`/admin/settings/intake-forms/${templateId}`}>Retry loading form</a></Button>
    </div>
  }
  if (!snapshot || snapshot.template.id !== templateId || snapshot.versions.some(version => version.template_id !== templateId) || (snapshot.draft && snapshot.draft.template_id !== templateId)) notFound()
  return <IntakeFormEditorClient initialSnapshot={snapshot} catalog={getIntakeFormBuilderCatalog(snapshot.template.purpose)} />
}
