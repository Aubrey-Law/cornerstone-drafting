'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'

interface DraftWithAiButtonProps {
  matterId: string
  channel: 'portal' | 'sms' | 'email'
  /** Attorney's rough notes or partial draft — passed as guidance, then replaced. */
  notes?: string
  onDraft: (draft: string) => void
}

/**
 * One-click AI draft for the communications composers. The reply is generated
 * from full matter context and always lands in the editor for attorney review —
 * never sent directly.
 */
export function DraftWithAiButton({ matterId, channel, notes, onDraft }: DraftWithAiButtonProps) {
  const [loading, setLoading] = useState(false)

  async function draft() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`/api/admin/matters/${matterId}/draft-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ channel, notes: notes?.trim() || undefined }),
      })
      const body = await response.json().catch(() => ({})) as { draft?: string; error?: string }
      if (!response.ok || !body.draft) throw new Error(body.error ?? 'Unable to draft')
      onDraft(body.draft)
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
      title="Draft this message with AI from the matter context"
    >
      <Sparkles className={`h-3.5 w-3.5 ${loading ? 'animate-pulse' : ''}`} />
      {loading ? 'Drafting…' : 'Draft with AI'}
    </Button>
  )
}
