import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { documentTemplateAdminClient, getDocumentTemplateVersion } from '@/lib/documentTemplates/repository'
import { getDocumentTemplateDefinition } from '@/lib/documentTemplates/registry'

type Params = { params: Promise<{ templateId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  const { templateId } = await params
  if (!getDocumentTemplateDefinition(templateId)) {
    return NextResponse.json({ error: 'Unknown document template' }, { status: 404 })
  }
  const body = await req.json().catch(() => null) as {
    versionId?: unknown
    expectedActiveVersionId?: unknown
    confirmation?: unknown
    action?: unknown
  } | null
  const versionId = typeof body?.versionId === 'string' ? body.versionId : ''
  const expected = typeof body?.expectedActiveVersionId === 'string' ? body.expectedActiveVersionId : null
  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation : ''
  const action = body?.action === 'rollback' ? 'rolled_back' : 'published'
  if (!versionId) return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
  try {
    const version = await getDocumentTemplateVersion(templateId, versionId)
    if (version.validation_status !== 'valid') {
      return NextResponse.json({ error: 'Template version has not passed validation' }, { status: 409 })
    }
    const client = documentTemplateAdminClient()
    const { data, error: publishError } = await client.rpc('publish_document_template_version', {
      p_template_id: templateId,
      p_version_id: versionId,
      p_expected_active_version_id: expected,
      p_actor_id: userId,
      p_confirmation: confirmation,
      p_event_type: action,
    })
    if (publishError) throw new Error(publishError.message)
    return NextResponse.json({ publication: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('changed') || message.includes('validation') || message.includes('confirmation') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export const runtime = 'nodejs'

