import { NextRequest, NextResponse } from 'next/server'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import PizZip from 'pizzip'
import { requireAdmin } from '@/lib/apiAuth'
import { loadCurrentDesignSheet } from '@/lib/designSheetImport/server'
import { buildStatularExportMarkdown } from '@/lib/designSheet/statularExport'
import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ZIP_CONTENT_TYPE = 'application/zip'
const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

// Both client-facing summaries (detailed plan summary + pre-meeting worksheet)
// live in this generator package. See packages/design-summary.json.
const DESIGN_SUMMARY_PACKAGE = 'design-summary' as const
// A reciprocal (separate) living-trust matter swaps the worksheet for the
// two-settlor interview form, which asks each trust's questions once per
// settlor. See packages/design-summary-separate.json.
const DESIGN_SUMMARY_SEPARATE_PACKAGE = 'design-summary-separate' as const

type Params = { params: Promise<{ id: string }> }

function clientSlug(value: string | null | undefined): string {
  const slug = (value ?? 'matter')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'matter'
}

function safeHeaderFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'design-summary.docx'
}

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params

  try {
    const matterId = await resolveMatterId(id)
    const payload = await buildDraftPayload(matterId)

    if (!payload.design_sheet_id) {
      return NextResponse.json(
        { error: 'No design sheet found for this matter. Complete the design sheet before exporting.' },
        { status: 422 },
      )
    }

    const data = toEstateGeneratorData(payload) as unknown as NodeEstateData
    const state = payload.client.state ?? 'MA'

    // ?format=json returns the raw generator data — the same object the
    // templates consume — as a download. This is the crossing artifact for
    // external drafting tooling (the aubreylaw-drafting assembler): the design
    // sheet's decisions, fully assembled, without rendering any documents.
    const format = req.nextUrl.searchParams.get('format')
    if (format === 'json') {
      const filename = safeHeaderFilename(
        `Generator-Data-${clientSlug(payload.client.full_name)}-${new Date().toISOString().slice(0, 10)}.json`,
      )
      return NextResponse.json(data, {
        status: 200,
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // ?format=statular renders the answers as Markdown in Statular's own
    // question wording. Statular's import extracts from uploaded files rather
    // than parsing a schema, and .md is on its accepted list, so this is the
    // upload that needs the least guessing at the other end. It reads the
    // design-sheet row directly — the generator payload above has already
    // reshaped the answers into template paths, which is the vocabulary this
    // export exists to avoid.
    if (format === 'statular') {
      const sheet = await loadCurrentDesignSheet(matterId)
      if (!sheet) {
        return NextResponse.json(
          { error: 'No design sheet found for this matter. Complete the design sheet before exporting.' },
          { status: 422 },
        )
      }

      const markdown = buildStatularExportMarkdown(sheet, {
        clientName: payload.client.full_name ?? null,
        spouseName: payload.spouse?.full_name ?? null,
        matterNumber: payload.matter.matter_number ?? null,
        exportedOn: new Date().toISOString().slice(0, 10),
      })
      const filename = safeHeaderFilename(
        `Statular-Import-${clientSlug(payload.client.full_name)}-${new Date().toISOString().slice(0, 10)}.md`,
      )
      return new NextResponse(markdown, {
        status: 200,
        headers: {
          'Content-Type': MARKDOWN_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // ?format=json-docx wraps the same JSON in a minimal Word document. Mike
    // only accepts office file types for uploads (pdf/docx/doc/xlsx/pptx/…),
    // so this is the upload-ready envelope: the body is the pretty-printed
    // JSON verbatim, one paragraph per line, monospace.
    if (format === 'json-docx') {
      const jsonText = JSON.stringify(data, null, 2)
      const doc = new Document({
        sections: [{
          children: jsonText.split('\n').map(line => new Paragraph({
            children: [new TextRun({ text: line, font: 'Courier New', size: 18 })],
            spacing: { after: 0 },
          })),
        }],
      })
      const buffer = await Packer.toBuffer(doc)
      const filename = safeHeaderFilename(
        `Generator-Data-${clientSlug(payload.client.full_name)}-${new Date().toISOString().slice(0, 10)}.docx`,
      )
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': DOCX_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const result = await generateNodeEstatePackage({
      data,
      packageName: payload.trust?.separate_trusts
        ? DESIGN_SUMMARY_SEPARATE_PACKAGE
        : DESIGN_SUMMARY_PACKAGE,
      state,
      allowDraft: true,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, missing: result.missing, warnings: result.warnings },
        { status: result.status },
      )
    }

    const slug = clientSlug(payload.client.full_name)
    const date = new Date().toISOString().slice(0, 10)

    // A single document downloads as a .docx; the full package (summary +
    // worksheet) downloads as a .zip. The client reads the filename from the
    // Content-Disposition header, so either content type works transparently.
    if (result.files.length === 1) {
      const file = result.files[0]
      const filename = safeHeaderFilename(`Design-Summary-${slug}-${date}.docx`)
      return new NextResponse(new Uint8Array(file.buffer), {
        status: 200,
        headers: {
          'Content-Type': DOCX_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const zip = new PizZip()
    for (const file of result.files) {
      zip.file(file.name, file.buffer)
    }
    const zipBuffer = zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
    const filename = safeHeaderFilename(`Design-Summary-${slug}-${date}.zip`)

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': ZIP_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to export design summary'
    console.error('[design-sheet/export]', id, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
