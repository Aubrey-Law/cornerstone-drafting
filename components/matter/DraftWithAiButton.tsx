'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'

interface DraftWithAiButtonProps {
  matterId?: string
  /** Optional alternate endpoint for non-matter contexts (for example lead drafting). */
  apiPath?: string
  channel: 'portal' | 'sms' | 'email'
  /** Attorney's rough notes or partial draft — passed as guidance, then replaced. */
  notes?: string
  onDraft: (draft: string) => void
  /** Optional hard cap applied after drafting before returning to the caller. */
  maxChars?: number
}

/**
 * One-click AI draft for the communications composers. The reply is generated
 * from full matter context and always lands in the editor for attorney review —
 * never sent directly.
 */
export function DraftWithAiButton({
  matterId,
  apiPath,
  channel,
  notes,
  onDraft,
  maxChars,
}: DraftWithAiButtonProps) {
  const [loading, setLoading] = useState(false)
  const draftRoute = apiPath ?? (matterId ? `/api/admin/matters/${matterId}/draft-reply` : null)

  const effectiveMax = maxChars ?? null

  async function draft() {
    setLoading(true)
    try {
      if (!draftRoute) throw new Error('No draft endpoint configured for this action')
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(draftRoute, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ channel, notes: notes?.trim() || undefined }),
      })
      const body = await response.json().catch(() => ({})) as { draft?: string; error?: string }
      if (!response.ok || !body.draft) throw new Error(body.error ?? 'Unable to draft')
      const drafted = effectiveMax ? body.draft.slice(0, effectiveMax) : body.draft
      onDraft(drafted)
      toast.success('Draft ready — review before sending')
    } catch (error) {
      toast.error((error as Error).message || 'Unable to draft')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={() => void draft()}
      title="Draft this message with AI"
    >
      <Sparkles className={`h-3.5 w-3.5 ${loading ? 'animate-pulse' : ''}`} />
      {loading ? 'Drafting…' : 'Draft with AI'}
    </Button>
  )
}
