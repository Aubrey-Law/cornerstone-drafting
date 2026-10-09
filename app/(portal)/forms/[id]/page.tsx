import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabaseServer'
import { MatterFormsError } from '@/lib/forms/matterForms'
import { getPortalClientForm } from '@/lib/forms/portalForms'
import { ClientFormFiller } from './ClientFormFiller'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PortalClientFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/login?redirectTo=${encodeURIComponent(`/forms/${id}`)}`)
  if (!UUID.test(id)) notFound()

  let loaded: Awaited<ReturnType<typeof getPortalClientForm>>
  try {
    loaded = await getPortalClientForm(user.id, id)
  } catch (error) {
    if (error instanceof MatterFormsError && error.status === 404) notFound()
    return <div className="mx-auto max-w-3xl px-4 py-8"><p role="alert" className="text-sm">This form is temporarily unavailable. Please try again shortly.</p></div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/forms" className="text-sm text-muted-foreground underline">All forms</Link>
      <ClientFormFiller form={loaded.form} assignment={loaded.assignment} />
    </div>
  )
}
