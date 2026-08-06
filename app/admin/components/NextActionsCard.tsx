import Link from 'next/link'
import { CalendarCheck } from 'lucide-react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmTodayKey } from '@/lib/firmDate'
import { presentNextAction } from '@/lib/matter/nextActionDate'
import { cn } from '@/lib/utils'

interface NextActionRow {
  client_id: string
  next_action_date: string | null
}

/**
 * The weekly board: every matter the attorney has told the app to come back to
 * within the next seven days, plus anything already past. Distinct from Coming
 * due, which is the SLA clock — this is the hand-set date.
 *
 * Renders nothing until at least one matter carries a next_action_date, so the
 * dashboard stays quiet until the column is in use.
 */
export async function NextActionsCard({ limit = 8 }: { limit?: number }) {
  const today = firmTodayKey()
  const horizon = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10)

  let rows: NextActionRow[] = []
  try {
    const { data, error } = await getAdminClient()
      .from('matter_details')
      .select('client_id, next_action_date')
      .not('next_action_date', 'is', null)
      .lte('next_action_date', horizon)
      .order('next_action_date', { ascending: true })
      .limit(limit)
    if (error) throw new Error(error.message)
    rows = (data ?? []) as NextActionRow[]
  } catch (e) {
    // The column arrives with the matter-page schema migration; before it lands
    // the dashboard simply does not show this card.
    console.warn('[next-actions] could not load next action dates', e)
    return null
  }

  if (rows.length === 0) return null

  const matterIds = rows.map(row => row.client_id)
  const { data: matters } = await getAdminClient()
    .from('v_matter_pipeline')
    .select('matter_id, client_name, matter_name')
    .in('matter_id', matterIds)

  const nameById = new Map(
    (matters ?? []).map(matter => [
      matter.matter_id as string,
      (matter.client_name ?? matter.matter_name ?? 'Unnamed matter') as string,
    ]),
  )

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <CalendarCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">Next actions this week</h2>
      </header>
      <ul className="divide-y divide-border">
        {rows.map(row => {
          const presentation = presentNextAction(row.next_action_date, today)
          if (!presentation) return null
          return (
            <li key={row.client_id}>
              <Link
                href={`/admin/matters/${row.client_id}`}
                className="block px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    presentation.tone === 'overdue' && 'text-red-strong',
                    presentation.tone === 'today' && 'text-amber-strong',
                  )}
                >
                  {presentation.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {nameById.get(row.client_id) ?? 'Unnamed matter'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
