import fs from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { DOCX_CONTENT_TYPE } from '@/lib/documentTemplates/docx'
import { getDocumentTemplateDefinition } from '@/lib/documentTemplates/registry'
import { downloadDocumentTemplateVersion } from '@/lib/documentTemplates/repository'
import { validateDocumentTemplateCandidate } from '@/lib/documentTemplates/validate'

type Params = { params: Promise<{ templateId: string; versionId: string }> }

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._ -]/g, '-').slice(0, 160)
}

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const { templateId, versionId } = await params
  const definition = getDocumentTemplateDefinition(templateId)
  if (!definition) return NextResponse.json({ error: 'Unknown document template' }, { status: 404 })
  try {
    let buffer: Buffer
    let filename: string
    if (versionId === 'bundled') {
      buffer = await fs.readFile(path.join(process.cwd(), definition.bundledPath))
      filename = path.basename(definition.bundledPath)
    } else {
      const downloaded = await downloadDocumentTemplateVersion(templateId, versionId)
      buffer = downloaded.buffer
      filename = String(downloaded.version.original_filename)
    }
    const matterId = req.nextUrl.searchParams.get('matterId')?.trim()
    if (matterId) {
      const preview = await validateDocumentTemplateCandidate(templateId, buffer, matterId)
      if (!preview.preview || !preview.previewFilename) {
        return NextResponse.json({ error: preview.report.error ?? 'Preview generation failed', report: preview.report }, { status: 422 })
      }
      return new NextResponse(new Uint8Array(preview.preview), {
        headers: {
          'Content-Type': preview.previewContentType,
          'Content-Disposition': `attachment; filename="${safeFilename(preview.previewFilename)}"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': DOCX_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: message.includes('not found') ? 404 : 500 })
  }
}

export const runtime = 'nodejs'

