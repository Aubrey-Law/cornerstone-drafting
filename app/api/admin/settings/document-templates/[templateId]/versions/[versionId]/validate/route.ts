import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import {
  downloadDocumentTemplateVersion,
  recordDocumentTemplateValidation,
} from '@/lib/documentTemplates/repository'
import { validateDocumentTemplateCandidate } from '@/lib/documentTemplates/validate'

type Params = { params: Promise<{ templateId: string; versionId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  const { templateId, versionId } = await params
  const body = await req.json().catch(() => null) as { matterId?: unknown } | null
  const matterId = typeof body?.matterId === 'string' ? body.matterId.trim() : ''
  if (!matterId) return NextResponse.json({ error: 'matterId is required' }, { status: 400 })
  try {
    const { buffer } = await downloadDocumentTemplateVersion(templateId, versionId)
    const result = await validateDocumentTemplateCandidate(templateId, buffer, matterId)
    await recordDocumentTemplateValidation({
      templateId,
      versionId,
      matterId,
      actorId: userId!,
      report: result.report as unknown as Record<string, unknown>,
      valid: result.report.valid,
    })
    return NextResponse.json({ report: result.report }, { status: result.report.valid ? 200 : 422 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export const runtime = 'nodejs'

