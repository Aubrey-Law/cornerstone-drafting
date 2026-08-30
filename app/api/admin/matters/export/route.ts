import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  clampMatterExportLimit,
  fetchMatterExportRows,
  MATTER_EXPORT_MAX_ROWS,
} from '@/lib/queries/matters'
import { matterSortKeyFrom, matterTableFiltersFrom } from '@/lib/adminTables/matterTable'
import { matterExportCsv, matterExportFilename, matterExportLabel } from '@/lib/matters/exportRows'

/**
 * The matters list export: the columns the list shows, as CSV.
 *
 * Filtered by the same vocabulary as the matters list (`search`, `practice`,
 * `stage`, `sort`), so a link the assistant hands back opens the same
 * selection the attorney asked it about. `format=json` returns the rows
 * instead, which is what the `export_matters` tool reads.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const query = new URL(req.url).searchParams
  const filters = matterTableFiltersFrom({
    search: query.get('search'),
    practice: query.get('practice'),
    stage: query.get('stage'),
  })
  const sort = matterSortKeyFrom(query.get('sort'))
  const limit = query.has('limit')
    ? clampMatterExportLimit(Number(query.get('limit')))
    : MATTER_EXPORT_MAX_ROWS

  let page
  try {
    page = await fetchMatterExportRows(filters, { sort, limit })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Matter export failed' },
      { status: 500 },
    )
  }

  if (query.get('format') === 'json') {
    return NextResponse.json({ matters: page.rows, total: page.total, truncated: page.truncated })
  }

  return new NextResponse(matterExportCsv(page.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${matterExportFilename(matterExportLabel(filters))}"`,
      // A matters list is client contact data; never let a proxy hold a copy.
      'Cache-Control': 'no-store',
    },
  })
}
