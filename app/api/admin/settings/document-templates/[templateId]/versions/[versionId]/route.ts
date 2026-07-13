import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { getDocumentTemplateDefinition } from '@/lib/documentTemplates/registry'
import { cancelDocumentTemplateVersion } from '@/lib/documentTemplates/repository'

type Params = { params: Promise<{ templateId: string; versionId: string }> }

export async function DELETE(req: Request, { params }: Params) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err

  const { templateId, versionId } = await params
  if (!getDocumentTemplateDefinition(templateId)) {
    return NextResponse.json({ error: 'Unknown document template' }, { status: 404 })
  }

  try {
    const result = await cancelDocumentTemplateVersion({
      templateId,
      versionId,
      actorId: userId!,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /cannot be canceled|already canceled|not found/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export const runtime = 'nodejs'
