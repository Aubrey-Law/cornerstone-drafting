import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { describeRecord, searchMatterRecords } from '@/lib/matterKnowledge'

const RESULT_LIMIT = 8

/**
 * GET /api/admin/assistant/records?query=… — matters and leads the attorney
 * can point a chat at. The same search the assistant's find_matter tool uses,
 * so the picker and the model agree on what a name resolves to.
 *
 * GET /api/admin/assistant/records?id=… — one record's label, for a chat
 * opened from a matter page link before it has been created.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(req.url).searchParams
  const id = params.get('id')?.trim() ?? ''
  if (id) {
    try {
      const record = await describeRecord(id)
      if (!record) return NextResponse.json({ error: 'No matter or lead with that id' }, { status: 404 })
      return NextResponse.json({ record })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, { status: 500 })
    }
  }
  const query = params.get('query')?.trim() ?? ''
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 })
  try {
    const records = await searchMatterRecords(query, RESULT_LIMIT)
    return NextResponse.json({ records })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Search failed' }, { status: 500 })
  }
}
