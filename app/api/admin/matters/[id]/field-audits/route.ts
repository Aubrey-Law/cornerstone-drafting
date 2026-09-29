import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { loadFieldAuditRunSummaries } from '@/lib/fieldAudit/history'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { isUuid } from '@/lib/queries/tasks'
import { reviewClient } from '@/lib/review/staff'
import { loadUnresolvedBlockers } from '@/lib/runs/advisory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/matters/[id]/field-audits
 *
 * What the matter's Reviews tab needs to run a field audit and show its
 * results: the published field-audit prompts, whether the matter has a design
 * sheet to audit, its recent runs, and any blocker on it nobody has decided.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  try {
    const client = reviewClient()
    const [prompts, runs, blockers, sheet] = await Promise.all([
      loadPublishedPrompts(client),
      loadFieldAuditRunSummaries(client, 15, { matterId: id }),
      loadUnresolvedBlockers(client),
      client.from('design_sheets').select('matter_id').eq('matter_id', id).limit(1),
    ])
    if (sheet.error) throw new Error(`Could not load the design sheet: ${sheet.error.message}`)

    return NextResponse.json({
      prompts: prompts.flatMap(prompt =>
        prompt.body.kind === 'field_audit'
          ? [{ slug: prompt.slug, title: prompt.title, checkCount: prompt.body.checks.length }]
          : [],
      ),
      hasDesignSheet: (sheet.data ?? []).length > 0,
      runs,
      unresolvedBlocker: blockers.find(blocker => blocker.matterId === id) ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load field audits' },
      { status: 500 },
    )
  }
}
