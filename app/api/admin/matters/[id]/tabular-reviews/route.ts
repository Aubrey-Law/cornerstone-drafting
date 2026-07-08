import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { defaultEstateColumns, columnsFromPreset } from '@/lib/estateTabularPresets'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** GET /api/admin/matters/[id]/tabular-reviews — list reviews for matter */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('tabular_reviews')
    .select('*')
    .eq('matter_id', matterId)
    .order('updated_at', { ascending: false })

  if (error) {
    if (error.message.includes('tabular_reviews') || error.message.includes('schema cache')) {
      return NextResponse.json({ reviews: [], unavailable: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ reviews: data ?? [] })
}

/** POST /api/admin/matters/[id]/tabular-reviews — create review + seed cells */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  const body = (await req.json().catch(() => null)) as {
    title?: string
    preset?: string
    documentIds?: string[]
    columns?: unknown
  } | null

  const columns =
    Array.isArray(body?.columns) && body.columns.length > 0
      ? body.columns
      : body?.preset
        ? columnsFromPreset(body.preset)
        : defaultEstateColumns()

  const documentIds = Array.isArray(body?.documentIds) ? body!.documentIds!.filter(Boolean) : []

  const admin = getAdminClient()
  const { data: review, error } = await admin
    .from('tabular_reviews')
    .insert({
      matter_id: matterId,
      title: body?.title?.trim() || 'Estate document review',
      columns_config: columns,
      document_ids: documentIds,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error || !review) {
    const status = error?.message.includes('tabular_reviews') ? 501 : 500
    return NextResponse.json({ error: error?.message ?? 'Failed to create review' }, { status })
  }

  if (documentIds.length > 0 && Array.isArray(columns)) {
    const cells = documentIds.flatMap(documentId =>
      (columns as Array<{ index: number }>).map(col => ({
        review_id: review.id,
        document_id: documentId,
        column_index: col.index,
        status: 'pending',
      })),
    )
    if (cells.length > 0) {
      await admin.from('tabular_cells').insert(cells)
    }
  }

  return NextResponse.json({ review }, { status: 201 })
}
