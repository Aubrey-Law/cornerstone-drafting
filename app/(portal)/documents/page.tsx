import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { fetchSharedDocuments, fetchClientUploads, fetchPortalDocumentRequests } from '@/lib/queries/portal'
import { getFirmConfig } from '@/lib/firmConfig'
import { firmTodayKey } from '@/lib/firmDate'
import { Button } from '@/components/ui/button'
import PortalDocumentList from './PortalDocumentList'
import ClientUploadCard from './ClientUploadCard'
import RequestedDocuments from './RequestedDocuments'
import { PortalPageHeader } from '../PortalPageHeader'

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

  const [documents, clientUploads, requests] = await Promise.all([
    fetchSharedDocuments(matter.id),
    fetchClientUploads(matter.id, user.id),
    // The list of what the firm asked for is additive: a failed read leaves
    // the page as it was rather than hiding the documents.
    fetchPortalDocumentRequests(matter.id).catch(() => []),
  ])

  const matterClosed = matter.status === 'closed'

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PortalPageHeader
        title="Documents"
        description={`Shared drafts and signed copies from ${firm.firmName}, and anything you send us.`}
      />

      {requests.length > 0 && (
        <div className="mb-6">
          <RequestedDocuments matterId={matter.id} matterClosed={matterClosed} requests={requests} today={firmTodayKey()} />
        </div>
      )}

      <PortalDocumentList documents={documents} />

      <div className="mt-6">
        <ClientUploadCard
          matterId={matter.id}
          matterClosed={matterClosed}
          initialUploads={clientUploads}
        />
      </div>
    </div>
  )
}
