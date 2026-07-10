import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { INTAKE_DOCUMENT_COLUMNS } from '@/lib/intake/intakeDocumentColumns'

type Params = { params: Promise<{ intakeId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { intakeId } = await params
  if (!intakeId?.trim()) {
    return NextResponse.json({ error: 'Missing intake id' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: intake, error: intakeError } = await admin
    .from('client_intake')
    .select('id')
    .eq('id', intakeId)
    .maybeSingle()

  if (intakeError) {
    return NextResponse.json({ error: intakeError.message }, { status: 500 })
  }
  if (!intake) {
    return NextResponse.json({ error: 'Intake not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('intake_documents')
    .select(INTAKE_DOCUMENT_COLUMNS)
    .eq('client_intake_id', intakeId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents: data ?? [] })
}
