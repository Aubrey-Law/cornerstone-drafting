import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Gavel,
  UserRound,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface OperationalBriefView {
  known: string[]
  missing: string[]
  clientFollowUp: string[]
  attorneyDecision: string[]
  conflicts: string[]
  nextStageLabel: string | null
  nextStageBlockers: string[]
  meetingPreparation?: string[]
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function List({ items, empty }: { items: string[]; empty: string }) {
  const rows = unique(items)
  return rows.length > 0
    ? <ul className="mt-1 space-y-1 text-xs text-foreground">{rows.map(item => <li key={item}>• {item}</li>)}</ul>
    : <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
}

export function OperationalBrief({ brief }: { brief: OperationalBriefView }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Operational brief</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <section aria-label="Known facts" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><CheckCircle2 className="h-3.5 w-3.5 text-green" /> Known</h3>
          <List items={brief.known} empty="No lifecycle facts confirmed yet." />
        </section>
        <section aria-label="Missing facts" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><CircleHelp className="h-3.5 w-3.5" /> Missing</h3>
          <List items={brief.missing} empty="No required facts are missing." />
        </section>
        <section aria-label="Client follow-up needed" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><UserRound className="h-3.5 w-3.5" /> Client follow-up</h3>
          <List items={brief.clientFollowUp} empty="Nothing currently owed by the client." />
        </section>
        <section aria-label="Attorney decisions needed" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Gavel className="h-3.5 w-3.5" /> Attorney decision</h3>
          <List items={brief.attorneyDecision} empty="No attorney decisions are outstanding." />
        </section>
        <section aria-label="Conflicts requiring review" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-amber" /> Conflicts</h3>
          <List items={brief.conflicts} empty="No conflicts require review." />
        </section>
        <section aria-label="Next lifecycle stage" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><ArrowRight className="h-3.5 w-3.5" /> Next stage</h3>
          <p className="mt-1 text-xs font-medium text-foreground">{brief.nextStageLabel ?? 'Complete'}</p>
          <List items={brief.nextStageBlockers} empty="No recorded blocker to the next stage." />
          {brief.meetingPreparation && brief.meetingPreparation.length > 0 ? (
            <div className="mt-2 border-t pt-2">
              <p className="text-xs font-semibold">Meeting preparation</p>
              <List items={brief.meetingPreparation} empty="" />
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  )
}
