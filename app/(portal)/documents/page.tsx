import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { fetchSharedDocuments, fetchClientUploads } from '@/lib/queries/portal'
import { getFirmConfig } from '@/lib/firmConfig'
import { Button } from '@/components/ui/button'
import PortalDocumentList from './PortalDocumentList'
import ClientUploadCard from './ClientUploadCard'

const firm = getFirmConfig()

export default async function DocumentsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const matter = await getMatterForUser(supabase, user.id)

  if (!matter) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Documents are not ready yet</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Once your intake is reviewed and your matter is set up, shared drafts and signed copies will appear here.
          </p>
          <Button asChild className="mt-5" size="sm">
            <Link href="/dashboard">Return to dashboard</Link>
          </Button>
        </div>
      </div>
    )
  }

  const [documents, clientUploads] = await Promise.all([
    fetchSharedDocuments(matter.id),
    fetchClientUploads(matter.id, user.id),
  ])

  const matterClosed = matter.status === 'closed'

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Client documents
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Documents</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Shared drafts and signed copies from {firm.firmName}.
        </p>
      </div>

      <div className="mb-6">
        <ClientUploadCard
          matterId={matter.id}
          matterClosed={matterClosed}
          initialUploads={clientUploads}
        />
      </div>

      <PortalDocumentList documents={documents} />
    </div>
  )
}
