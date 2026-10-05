import Link from 'next/link'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { stageInfo } from '@/types/database'
import {
  formatLastMilestone,
  matterIntakeBadge,
  matterLastMilestoneAt,
  matterRecencyTone,
  matterSubtitle,
  matterTitle,
} from '@/lib/matters/cardFacts'
import { matterHref } from '@/lib/matters/matterActions'
import type { MatterListRow } from '@/lib/queries/matters'
import { RecordWorkIndicator } from '@/components/work/RecordWorkIndicator'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'

const BADGE_TONE: Record<string, string> = {
  success: 'border-green/40 bg-green-bg text-green',
  warning: 'border-amber-border bg-amber-bg text-amber',
  muted: 'border-border bg-muted text-muted-foreground',
}

export function RecentMattersTable({
  matters,
  workSummaries = {},
}: {
  matters: MatterListRow[]
  workSummaries?: Record<string, RecordWorkSummary>
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <div>
          <CardTitle className="text-sm">Recently active</CardTitle>
          <p className="text-xs text-muted-foreground">
            Matters by their most recent milestone
          </p>
        </div>
        <CardAction>
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href="/admin/matters/list">All matters</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {matters.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No matters yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Intake</TableHead>
                  <TableHead>Next action</TableHead>
                  <TableHead className="text-right">Last milestone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matters.map(matter => {
                  const badge = matterIntakeBadge(matter)
                  const milestone = matterLastMilestoneAt(matter)
                  return (
                    <TableRow key={matter.matter_id}>
                      <TableCell>
                        <Link
                          href={matterHref(matter.matter_id)}
                          className="font-medium text-foreground hover:underline"
                        >
                          {matterTitle(matter)}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {matterSubtitle(matter)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {stageInfo(matter.stage).label}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('text-micro capitalize', BADGE_TONE[badge.tone])}
                        >
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[18rem]">
                        <RecordWorkIndicator summary={workSummaries[matter.matter_id]} />
                      </TableCell>
                      <TableCell
                        className={cn('whitespace-nowrap text-right', matterRecencyTone(milestone))}
                      >
                        {formatLastMilestone(milestone)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
