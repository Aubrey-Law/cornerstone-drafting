import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { loadR2Bytes } from '@/lib/documentApiHelpers'
import { worksDb } from '@/lib/works/data'

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string; artifactId: string }> }) {
  const auth = await requireAdmin(_req)
  if (auth.err) return auth.err
  const { runId, artifactId } = await params
  const { data, error } = await worksDb().from('work_run_artifacts').select('*').eq('id', artifactId).eq('run_id', runId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.promotion_status === 'cancelled') return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  const bytes = await loadR2Bytes(data.r2_key)
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': data.content_type, 'Content-Disposition': `attachment; filename="${String(data.filename).replace(/["\r\n]/g, '_')}"`, 'Cache-Control': 'private, no-store' },
  })
}
