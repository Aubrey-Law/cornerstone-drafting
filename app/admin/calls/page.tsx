import { Suspense } from 'react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { CallsPageClient, type AdminCallRow } from './CallsPageClient'

export const dynamic = 'force-dynamic'

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter = 'unassigned' } = await searchParams
  const supabase = await createServerSupabase()

  let q = supabase
    .from('calls')
    .select(
      'id, direction, status, participant_number, started_at, duration_seconds, recording_url, voicemail_url, summary, firm_user_email, matter_id',
    )
    .order('started_at', { ascending: false })
    .limit(200)

  if (filter === 'unassigned') {
    q = q.is('matter_id', null)
  }

  const { data, error } = await q
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Calls</h1>
        <p className="text-sm text-destructive">
          Could not load calls ({error.message}). Apply the communications migration if needed.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Calls</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Triage unassigned Twilio / Retell calls and link them to matters.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <CallsPageClient initialCalls={(data ?? []) as AdminCallRow[]} filter={filter} />
      </Suspense>
    </div>
  )
}
