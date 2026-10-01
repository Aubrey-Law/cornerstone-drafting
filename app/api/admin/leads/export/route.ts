import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchLeadExportRows } from '@/lib/queries/leadList'
import { leadListParamsFrom } from '@/lib/leads/listParams'
import {
  clampLeadExportLimit,
  leadExportCsv,
  leadExportFilename,
  LEAD_EXPORT_MAX_ROWS,
} from '@/lib/leads/exportRows'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { attentionRecordIds, buildRecordWorkSummaries } from '@/lib/work/recordSummary'

/**
 * The leads contact export: name, email and phone as CSV.
 *
 * Filtered by the same vocabulary as the leads list (`status`, `search`,
 * `practice`, `progress`, `sort`), so a link the assistant hands back opens
 * the same selection the attorney asked it about. `format=json` returns the
 * rows instead, which is what the `export_leads` tool reads.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const query = new URL(req.url).searchParams
  const params = leadListParamsFrom(
    {
      status: query.get('status'),
      card: query.get('card'),
      search: query.get('search'),
      practice: query.get('practice'),
      progress: query.get('progress'),
      sort: query.get('sort'),
    },
    { sort: 'name_asc' },
  )
  const limit = query.has('limit')
    ? clampLeadExportLimit(Number(query.get('limit')))
    : LEAD_EXPORT_MAX_ROWS

  let page
  try {
    const attentionIds = params.card === 'attention'
      ? attentionRecordIds(buildRecordWorkSummaries(
          (await fetchWorkGraphForUser(auth.userId)).items,
          'lead',
        ))
      : undefined
    page = await fetchLeadExportRows(params, { limit, attentionIds })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lead export failed' },
      { status: 500 },
    )
  }

  if (query.get('format') === 'json') {
    return NextResponse.json({
      leads: page.rows.map(({ name, email, phone }) => ({ name, email, phone })),
      total: page.total,
      truncated: page.truncated,
    })
  }

  return new NextResponse(leadExportCsv(page.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${leadExportFilename(params.status)}"`,
      // A lead list is client contact data; never let a proxy hold a copy.
      'Cache-Control': 'no-store',
    },
  })
}
