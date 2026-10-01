import { AlertTriangle, CheckCircle2, Gavel, UserRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { stageLabel } from '@/types/database'
import type { matterOperationalBrief } from '@/lib/lifecycle/requirements'

type Brief = ReturnType<typeof matterOperationalBrief>

function List({ items, empty }: { items: string[]; empty: string }) {
  return items.length
    ? <ul className="mt-1 space-y-1 text-xs text-foreground">{items.map(item => <li key={item}>• {item}</li>)}</ul>
    : <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
}

export function MatterOperationalBrief({ brief }: { brief: Brief }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Operational brief</CardTitle>
          <span className="text-xs text-muted-foreground">
            Next stage: {brief.nextStage ? stageLabel(brief.nextStage) : 'Complete'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <section aria-label="Known facts" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><CheckCircle2 className="h-3.5 w-3.5 text-green" /> Known</h3>
          <List items={brief.known} empty="No lifecycle facts confirmed yet." />
        </section>
        <section aria-label="Missing client information" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><UserRound className="h-3.5 w-3.5" /> Client follow-up</h3>
          <List items={[...new Set([...brief.missing, ...brief.clientFollowUp])]} empty="Nothing currently owed by the client." />
        </section>
        <section aria-label="Attorney decisions" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Gavel className="h-3.5 w-3.5" /> Attorney decision</h3>
          <List items={brief.attorneyDecision} empty="No attorney decisions block this stage." />
        </section>
        <section aria-label="Conflicts and blockers" className="rounded-lg border p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-amber" /> Blockers</h3>
          <List items={[...new Set([...brief.blockers.map(item => item.label), ...brief.conflicts])]} empty="No lifecycle blockers found." />
        </section>
      </CardContent>
    </Card>
  )
}
