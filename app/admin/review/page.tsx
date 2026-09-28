import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { loadRunSummaries } from '@/lib/review/history'
import { loadScanSummaries } from '@/lib/review/scans'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { RunHistoryList } from './components/RunHistoryList'
import { ScanHistoryList } from './components/ScanHistoryList'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Reviews' }

/**
 * Every recorded review, newest first: reviews of filed documents, of uploaded
 * prior plans, and those run from the Word add-in's Review tab.
 */
export default async function ReviewHistoryPage() {
  await requireStaffPage()
  const client = reviewClient()
  const [runs, scans] = await Promise.all([loadRunSummaries(client, 100), loadScanSummaries(client, { limit: 100 })])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reviews"
        description="Playbook reviews and their findings. Reviews run from the Review tab in Word are saved here, with a copy of the document as it was in Word."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/field-audits">Field audits</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/playbooks">Build a playbook</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/review/new">Start a review</Link>
            </Button>
          </>
        }
      />
      <Card className="gap-0 py-0">
        <CardHeader className="block space-y-1 border-b py-3 [.border-b]:pb-3">
          <CardTitle className="text-sm">Playbook reviews</CardTitle>
        </CardHeader>
        {runs.length > 0 ? (
          <RunHistoryList runs={runs} />
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="No reviews yet"
            description="Start one here, or from the Review tab in Word."
            className="py-8"
          />
        )}
      </Card>
      {scans.length > 0 ? (
        <Card className="gap-0 py-0">
          <CardHeader className="block space-y-1 border-b py-3 [.border-b]:pb-3">
            <CardTitle className="text-sm">Issue spotting and proofreading</CardTitle>
            <CardDescription className="text-xs">
              Checks run from the Review tab in Word, against the same saved copy of the document.
            </CardDescription>
          </CardHeader>
          <ScanHistoryList scans={scans} />
        </Card>
      ) : null}
    </div>
  )
}
