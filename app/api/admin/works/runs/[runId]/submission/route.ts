import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { submissionCsv } from '@/lib/metlife/generate'
import type { MetlifeSubmissionRow } from '@/lib/metlife/types'
import { worksDb } from '@/lib/works/data'

/**
 * GET /api/admin/works/runs/[runId]/submission — the Portal Submission Table.
 *
 * Cornerstone prepares the claim; the portal entry itself happens in the
 * browser via the submit-metlife-claim skill. This hands that skill the same
 * numbered rows the document prints, so the two can never disagree.
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { runId } = await params
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'json'

  const db = worksDb()
  const { data: run, error } = await db.from('work_runs').select('id, input_snapshot').eq('id', runId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const rows = run.input_snapshot?.metlife?.submissionRows as MetlifeSubmissionRow[] | undefined
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'This run has no MetLife submission table' }, { status: 404 })
  }

  if (format === 'csv') {
    return new Response(submissionCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="metlife-submission-${runId}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }
  return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'private, no-store' } })
}
