'use client'

import { FileText, Signature } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RecordTabHeader } from '@/components/RecordTabHeader'
import { ViewSwitch, type ViewSwitchOption } from '@/components/ViewSwitch'
import type { DocumentView } from '@/lib/matterPageTabs'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { PipelineMatter } from '@/types/database'
import { MatterSigningPanel } from './tabs/signing/MatterSigningPanel'
import { MatterDocumentsTab } from './MatterDocumentsTab'
import { RequestedDocumentsCard } from './RequestedDocumentsCard'
import { useMatterDocuments } from './useMatterDocuments'
import type { DocumentScope } from './useMatterTabs'

const DOCUMENT_VIEW_OPTIONS: readonly ViewSwitchOption<DocumentView>[] = [
  { value: 'files', label: 'Files', icon: FileText },
  { value: 'signing', label: 'Signing', icon: Signature },
]

/** The Documents tab: requested documents and files, or the signing panel. Loads only while the tab is open. */
export function MatterDocumentsWorkspace({
  matter, enabled, view, onViewChange, scope, onScopeChange, deepLinkedDocumentId, probate,
  unreviewedUploadCounts, onReviewPortalUploads, onReviewIntakeUploads, esignDocumentsEnabled,
}: {
  matter: PipelineMatter
  enabled: boolean
  view: DocumentView
  onViewChange: (view: DocumentView) => void
  scope: DocumentScope
  onScopeChange: (scope: DocumentScope) => void
  deepLinkedDocumentId: string | null
  probate: boolean
  unreviewedUploadCounts: UnreviewedUploadCounts
  onReviewPortalUploads: () => void | Promise<void>
  onReviewIntakeUploads: () => void | Promise<void>
  esignDocumentsEnabled: boolean
}) {
  const matterId = matter.matter_id
  const { documents, folders, signatureRequests, loading, documentsError, foldersError, reload } = useMatterDocuments(matterId, enabled)
  return (
    <>
      <RecordTabHeader
        title="Documents"
        description={view === 'signing'
          ? 'The signing checklist and ceremony record for the drafted documents.'
          : 'Drafts, client uploads, and shared files for this matter.'}
        actions={
          <ViewSwitch
            value={view}
            options={DOCUMENT_VIEW_OPTIONS}
            onChange={onViewChange}
            label="Documents view"
          />
        }
      />
      {view === 'signing' ? (
        <MatterSigningPanel matterId={matterId} />
      ) : (
        <>
          {(documentsError || foldersError) && (
            <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">
              <p>{documentsError || foldersError}</p>
              <Button variant="outline" size="sm" disabled={loading} onClick={() => void reload()}>Retry</Button>
            </div>
          )}
          <RequestedDocumentsCard matterId={matterId} onChanged={reload} probate={probate} />
          <MatterDocumentsTab
            matterId={matterId}
            clientName={matter.client_name}
            deepLinkedDocumentId={deepLinkedDocumentId}
            initialScope={scope}
            onScopeChange={onScopeChange}
            documents={documents}
            folders={folders}
            loading={loading}
            loadError={documentsError}
            onDocumentsChanged={reload}
            unreviewedUploadCounts={unreviewedUploadCounts}
            onReviewPortalUploads={onReviewPortalUploads}
            onReviewIntakeUploads={onReviewIntakeUploads}
            esignDocumentsEnabled={esignDocumentsEnabled}
            signatureRequests={signatureRequests}
            defaultSigner={matter.client_email
              ? { name: matter.client_name ?? '', email: matter.client_email }
              : null}
          />
        </>
      )}
    </>
  )
}
