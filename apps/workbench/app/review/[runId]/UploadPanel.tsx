'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@aubrey-law/ui/button'
import { linkUpload, type LinkUploadState } from './actions'

const INITIAL: LinkUploadState = { ok: null, message: null }

/**
 * For a review of an unfiled upload: link the upload to a matter once there is
 * one, and review it again — with another playbook, or with the same one now
 * that the matter's design sheet can decide which conditional rules apply.
 */
export function UploadPanel({
  runId,
  reviewUploadId,
  linkedMatterId,
  linkedMatterTitle,
  filed,
  matters,
  playbooks,
}: {
  runId: string
  reviewUploadId: string
  linkedMatterId: string | null
  linkedMatterTitle: string | null
  /** Filed as one of the linked matter's documents, from that matter's Documents tab. */
  filed: boolean
  matters: Array<{ matterId: string; title: string }>
  playbooks: Array<{ slug: string; title: string }>
}) {
  const router = useRouter()
  const [state, action, linking] = useActionState(linkUpload, INITIAL)
  const [slug, setSlug] = useState(playbooks[0]?.slug ?? '')
  const [queueing, setQueueing] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)

  const reviewAgain = async () => {
    setQueueing(true)
    setQueueError(null)
    const body = new FormData()
    body.set('reviewUploadId', reviewUploadId)
    if (slug) body.set('playbookSlug', slug)
    try {
      const response = await fetch('/api/staff/review', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok || !payload?.runId) {
        setQueueError(typeof payload?.error === 'string' ? payload.error : 'The review could not be queued.')
        return
      }
      router.push(`/review/${payload.runId}`)
    } catch {
      setQueueError('The review could not be reached. Check your connection and try again.')
    } finally {
      setQueueing(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3 pt-2 text-xs" data-testid="upload-panel">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="reviewUploadId" value={reviewUploadId} />
        <input type="hidden" name="runId" value={runId} />
        <span className="text-muted-foreground" data-testid="upload-link-state">
          {linkedMatterId ? `Linked to ${linkedMatterTitle ?? 'a matter'}` : 'Not linked to a matter'}
        </span>
        {linkedMatterId ? (
          <span className="text-muted-foreground" data-testid="upload-filed-state">
            {filed
              ? "In the matter's documents."
              : "To add it to the matter's documents, use Add to documents on the matter's Documents tab."}
          </span>
        ) : null}
        {/* Keyed on the saved link so the picker resets to it when the page
            refreshes after saving, rather than keeping a stale choice. */}
        <select
          key={linkedMatterId ?? 'none'}
          name="matterId"
          aria-label="Link to matter"
          defaultValue={linkedMatterId ?? ''}
          className="h-8 max-w-64 rounded-md border border-input bg-transparent px-2"
        >
          <option value="">No matter</option>
          {matters.map((matter) => (
            <option key={matter.matterId} value={matter.matterId}>
              {matter.title}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={linking}>
          {linking ? 'Saving…' : 'Save link'}
        </Button>
        {state.message ? (
          <span role="status" className={state.ok ? 'text-muted-foreground' : 'text-destructive'}>
            {state.message}
          </span>
        ) : null}
      </form>

      {playbooks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Playbook for another review"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className="h-8 max-w-64 rounded-md border border-input bg-transparent px-2"
          >
            {playbooks.map((playbook) => (
              <option key={playbook.slug} value={playbook.slug}>
                {playbook.title}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" onClick={() => void reviewAgain()} disabled={queueing}>
            {queueing ? 'Queueing…' : 'Review again'}
          </Button>
          <span className="text-muted-foreground">
            {linkedMatterId ? "Uses the linked matter's design sheet." : 'No matter linked: every rule runs.'}
          </span>
          {queueError ? <span className="text-destructive">{queueError}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
