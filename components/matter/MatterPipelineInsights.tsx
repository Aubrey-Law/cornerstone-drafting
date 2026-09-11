'use client'

import { AlertCircle, Briefcase, FileSignature, Inbox } from 'lucide-react'
import { matterLastActivityAt } from '@/lib/adminTables/matterTable'
import { isClosedMatter } from '@/lib/matters/closedMatter'
import type { MatterListRow } from '@/lib/queries/matters'
import { stageInfo } from '@/types/database'

/**
 * The matters list's overview strip — the leads list's insight cards, computed
 * from matters and nothing else.
 *
 * The two lists are deliberately disjoint: `fetchMattersList` reads the hired
 * pipeline view, the leads loader reads `client_intake` rows still in a lead
 * state. Neither set of cards can therefore count the other's records, which is
 * what makes each number answerable — "12 open matters" means twelve retained
 * clients, not twelve rows of mixed lifecycle.
 */

/** Cards that narrow the table; `open` just clears back to no card filter. */
export type MatterCardFilter = 'open' | 'attention' | 'signing'

const QUIET_DAYS = 14
const SIGNING_WINDOW_DAYS = 30

/**
 * Everything still running: not closed by status, and not at a closed stage.
 * Both axes, because the firm closes matters along both — see
 * `lib/matters/closedMatter.ts`.
 */
export function isOpenMatter(matter: MatterListRow): boolean {
  return !isClosedMatter(matter) && stageInfo(matter.stage).group !== 'closed'
}

export function awaitingIntake(matter: MatterListRow): boolean {
  return !matter.intake_submitted_at
}

/**
 * Quiet for two weeks, or carrying uploads nobody has looked at. Both are
 * things the firm owes the client, which is what a "needs attention" card is
 * for — a stage alone never earns a matter a place here.
 */
export function matterNeedsAttention(matter: MatterListRow, now = Date.now()): boolean {
  if ((matter.unreviewed_upload_count ?? 0) > 0) return true
  const latest = matterLastActivityAt(matter)
  return latest === null || latest < now - QUIET_DAYS * 86_400_000
}

/** A signing date inside the window that has not been executed yet. */
export function signingSoon(matter: MatterListRow, now = Date.now()): boolean {
  if (matter.documents_executed_at) return false
  if (!matter.signing_date) return false
  const signing = Date.parse(matter.signing_date)
  if (Number.isNaN(signing)) return false
  return signing >= now - 86_400_000 && signing <= now + SIGNING_WINDOW_DAYS * 86_400_000
}

export function MatterPipelineInsights({
  matters,
  totals,
  activeFilter = null,
  onToggleFilter,
}: {
  matters: MatterListRow[]
  totals?: {open:number;attention:number;signing:number;intakePending:number;unreviewed:number}
  activeFilter?: MatterCardFilter | null
  onToggleFilter?: (filter: MatterCardFilter) => void
}) {
  const open = matters.filter(isOpenMatter)
  const attention = totals?.attention ?? open.filter(matter => matterNeedsAttention(matter)).length
  const signing = totals?.signing ?? open.filter(matter => signingSoon(matter)).length
  const intakePending = totals?.intakePending ?? open.filter(awaitingIntake).length
  const unreviewed = totals?.unreviewed ?? open.reduce((total, matter) => total + (matter.unreviewed_upload_count ?? 0), 0)

  const insights: {
    label: string
    value: string
    detail: string
    icon: typeof Briefcase
    filter: MatterCardFilter | null
  }[] = [
    {
      label: 'Open matters',
      value: String(totals?.open ?? open.length),
      detail: `${intakePending} awaiting intake`,
      icon: Briefcase,
      filter: 'open',
    },
    {
      label: 'Needs attention',
      value: String(attention),
      detail: `Quiet ${QUIET_DAYS}+ days or unreviewed uploads`,
      icon: AlertCircle,
      filter: 'attention',
    },
    {
      label: 'Signing soon',
      value: String(signing),
      detail: `Target signing in the next ${SIGNING_WINDOW_DAYS} days`,
      icon: FileSignature,
      filter: 'signing',
    },
    {
      label: 'Uploads to review',
      value: String(unreviewed),
      detail: 'Intake and portal documents',
      icon: Inbox,
      filter: null,
    },
  ]

  return (
    <section aria-label="Matter insights" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {insights.map(({ label, value, detail, icon: Icon, filter }) => {
        const clickable = Boolean(filter && onToggleFilter)
        const active = filter !== null && filter === activeFilter
        const card = (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {active ? 'Filtering — click to clear' : detail}
            </p>
          </>
        )
        if (!clickable) {
          return (
            <div key={label} className="rounded-lg border bg-card p-3">
              {card}
            </div>
          )
        }
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onToggleFilter?.(filter!)}
            className={`rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40 ${
              active ? 'border-primary ring-1 ring-primary' : ''
            }`}
          >
            {card}
          </button>
        )
      })}
    </section>
  )
}
