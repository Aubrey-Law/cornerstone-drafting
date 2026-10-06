import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { fetchPortalSignature } from '@/lib/portal/signaturesServer'
import { signatureTitle } from '@/lib/portal/signatures'
import { SigningExperience } from '@/components/esign/SigningExperience'
import { PortalPageHeader } from '../../../PortalPageHeader'

export const dynamic = 'force-dynamic'

/**
 * Signing from inside the portal.
 *
 * The same experience the emailed link opens, reached with the client's own
 * account instead of the token. The page confirms the session is on this
 * client's matter and addressed to them before rendering anything, and the
 * route behind the component (/api/documents/sign/[sessionId]) confirms it
 * again on every call.
 */
export default async function PortalSignPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const matter = await getMatterForUser(supabase, user.id)
  if (!matter) notFound()

  const { sessionId } = await params
  const signature = await fetchPortalSignature(matter.id, user.email ?? null, sessionId)
  if (!signature) notFound()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/documents" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Documents
      </Link>
      <PortalPageHeader
        title={signatureTitle(signature)}
        description="Read it through, then sign below. Your signature is recorded with the date and a copy is kept in your documents."
      />
      <SigningExperience
        endpoint={`/api/documents/sign/${encodeURIComponent(signature.sessionId)}`}
        withSession
        embedded
        doneHref="/documents"
      />
    </div>
  )
}
