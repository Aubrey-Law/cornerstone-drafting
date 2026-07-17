import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { requireAdmin } from '@/lib/apiAuth'
import { loadR2Bytes } from '@/lib/documentApiHelpers'
import { worksDb } from '@/lib/works/data'

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { runId } = await params
  const db = worksDb()
  const { data: run } = await db.from('work_runs').select('id').eq('id', runId).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  const { data, error } = await db.from('work_run_artifacts').select('*').eq('run_id', runId).neq('promotion_status', 'cancelled').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'No artifacts available' }, { status: 404 })
  const zip = new JSZip()
  for (const artifact of data) zip.file(artifact.filename, await loadR2Bytes(artifact.r2_key))
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="PMPS-Package.zip"', 'Cache-Control': 'private, no-store' } })
}
