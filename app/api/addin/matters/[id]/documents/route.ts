import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { DOCX_CONTENT_TYPE } from '@/lib/documentApiHelpers'
import { resolveMatterId } from '@/lib/buildDraftPayload'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * The matter's Word documents, for linking the open file to one of them.
 *
 * DOCX only: a version saved from the pane is the open Word document, so a PDF
 * row is not something this pane could ever be looking at.
 *
 * Superseded drafts are included but flagged. A superseded document is the
 * likeliest wrong answer in the list — it is exactly the file an attorney still
 * has open from last week — so the pane marks it rather than hiding it, since
 * hiding it would leave them unable to explain why their document is missing.
 */
export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const admin = getAdminClient()
  // Leads included: a lead's engagement agreement is a Word document on its
  // opportunity's matters row, and the pane offers those matters for editing it.
  // Listing documents reads no drafting data, which is what hired-only guards.
  const matterId = await resolveMatterId(id, admin, { includeLeads: true })

  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .eq('content_type', DOCX_CONTENT_TYPE)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    {
      documents: (data ?? []).map(row => ({
        id: row.id,
        name: row.name,
        size: row.size,
        createdAt: row.created_at,
        currentVersionId: row.current_version_id ?? null,
        superseded: Boolean(row.superseded_at),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
