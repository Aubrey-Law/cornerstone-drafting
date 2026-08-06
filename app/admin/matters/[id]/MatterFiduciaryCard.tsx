'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MatterPlanMirror } from '@/lib/matter/planMirror'

interface MatterFiduciaryCardProps {
  matterId: string
  planMirror: MatterPlanMirror
}

/**
 * The ten fiduciary appointments, primary and successor, mirrored from the
 * design sheet. Read-only on purpose — the sheet owns them, and the matter
 * page's job is to let the attorney sanity-check the names against the real
 * household sitting beside it.
 */
export function MatterFiduciaryCard({ matterId, planMirror }: MatterFiduciaryCardProps) {
  const designHref = `/admin/drafting/${matterId}?step=design`
  const anyNamed = planMirror.fiduciaries.some(role => role.primary || role.successor)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Fiduciary appointments</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Link href={designHref} className="text-xs font-medium text-accent hover:underline">
            Edit on the design sheet
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {!anyNamed ? (
          <p className="text-xs text-muted-foreground">
            No fiduciaries named yet.{' '}
            <Link href={designHref} className="font-medium text-accent hover:underline">
              Open the design sheet
            </Link>{' '}
            to appoint them.
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {planMirror.fiduciaries.map(role => (
              <div key={role.key} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">{role.role}</dt>
                <dd className="text-sm">
                  <span className="font-medium">{role.primary ?? '—'}</span>
                  <span className="block text-xs text-muted-foreground">
                    Successor: {role.successor ?? '—'}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Read-only mirror of the design sheet — primary and successor for each role.
        </p>
      </CardContent>
    </Card>
  )
}
