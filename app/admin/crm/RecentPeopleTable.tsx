import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CrmPeopleRow } from '@/lib/queries/cornerstoneCrm'
import { formatDate } from '@/lib/utils'

const LIFECYCLE_TONE: Record<string, string> = {
  converted: 'border-green/30 bg-green-bg text-green',
  qualified: 'border-green/30 bg-green-bg text-green',
  working: 'border-amber-border bg-amber-bg text-amber',
  contacted: 'border-amber-border bg-amber-bg text-amber',
  nurture: 'border-border bg-muted text-muted-foreground',
  closed_lost: 'border-destructive/30 bg-red-bg text-destructive',
}

function lifecycleLabel(value: string | null): string {
  if (!value) return 'Unassigned'
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
}

export function RecentPeopleTable({ people }: { people: CrmPeopleRow[] }) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
        <CardTitle className="text-sm">Newest people</CardTitle>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href="/admin/crm/people">Open directory</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {people.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No people in the CRM yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map(person => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">
                      {person.sourceRecordHref ? (
                        <Link
                          href={person.sourceRecordHref}
                          className="hover:text-primary hover:underline"
                        >
                          {person.name}
                        </Link>
                      ) : person.name}
                      {person.stageName && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {person.stageName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          LIFECYCLE_TONE[person.lifecycleStatus ?? '']
                          ?? 'border-border bg-muted text-muted-foreground'
                        }
                      >
                        {lifecycleLabel(person.lifecycleStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{person.email ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {person.leadSource ?? person.referralSource ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDate(person.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
