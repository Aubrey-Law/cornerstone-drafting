import { NextResponse } from 'next/server'
import { auditDocumentAccess, isAdminUser } from '@/lib/documentSecurity'
import {
  DOCX_CONTENT_TYPE,
  getDocumentApiUser,
  isDocxDocument,
  loadR2Bytes,
  PDF_CONTENT_TYPE,
} from '@/lib/documentApiHelpers'
import {
  convertDocxToPdf,
  DocxPdfConvertError,
  DocxPdfConvertNotConfiguredError,
  isDocxPdfConvertConfigured,
} from '@/lib/docxPdfConvert'
import { createDocumentVersion, ensureInitialVersion, loadActiveVersion } from '@/lib/documentVersions'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * POST /api/documents/[id]/convert-pdf
 * Converts the active DOCX via the external LibreOffice worker and registers a PDF
 * matter_documents row in the review folder (for client share).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isDocxPdfConvertConfigured()) {
    return NextResponse.json(
      {
        error:
          'DOCX→PDF conversion is not configured. Set DOCX_PDF_CONVERT_URL and DOCX_PDF_CONVERT_SECRET, or use Upload PDF to share.',
        code: 'convert_not_configured',
      },
      { status: 501 },
    )
  }

  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isDocxDocument(doc)) {
    return NextResponse.json({ error: 'Only DOCX documents can be converted' }, { status: 415 })
  }

  await auditDocumentAccess(sb, user, doc, 'convert', {
    route: '/api/documents/[id]/convert-pdf',
  })

  try {
    await ensureInitialVersion({
      admin: sb,
      documentId: id,
      r2Key: doc.r2_key,
      filename: doc.name,
      contentType: doc.content_type || DOCX_CONTENT_TYPE,
      sizeBytes: doc.size,
      source: doc.generation_id ? 'generated' : 'upload',
      createdBy: user.id,
    })

    const version = await loadActiveVersion(sb, id)
    const bytes = await loadR2Bytes(version?.r2_key ?? doc.r2_key)
    const pdfBytes = await convertDocxToPdf(bytes, doc.name)

    const pdfName = doc.name.replace(/\.docx$/i, '') + '.pdf'
    const safe = safeUploadFilename(pdfName)
    const pdfKey = `matters/${doc.matter_id}/review/${Date.now()}-${safe}`
    await putFileToR2(pdfKey, pdfBytes, PDF_CONTENT_TYPE)

    const { data: pdfDoc, error: insertErr } = await sb
      .from('matter_documents')
      .insert({
        matter_id: doc.matter_id,
        r2_key: pdfKey,
        name: pdfName,
        size: pdfBytes.byteLength,
        content_type: PDF_CONTENT_TYPE,
        folder: 'review',
        folder_id: null,
        source: 'firm',
        shared_at: new Date().toISOString(),
        uploaded_by: user.id,
        generation_id: doc.generation_id ?? null,
        generation_engine: doc.generation_engine ?? null,
        marker_count: 0,
        missing_count: 0,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()

    if (insertErr || !pdfDoc) {
      return NextResponse.json({ error: insertErr?.message ?? 'Failed to register PDF' }, { status: 500 })
    }

    // Store converted PDF key on the DOCX version when versions table exists
    if (version) {
      await sb
        .from('document_versions')
        .update({ pdf_r2_key: pdfKey })
        .eq('id', version.id)

      await createDocumentVersion({
        admin: sb,
        documentId: pdfDoc.id,
        matterId: doc.matter_id,
        bytes: pdfBytes,
        filename: pdfName,
        contentType: PDF_CONTENT_TYPE,
        source: 'converted_pdf',
        createdBy: user.id,
        folder: 'review',
      }).catch(() => null)
    }

    return NextResponse.json({ document: pdfDoc, sourceDocumentId: id })
  } catch (err) {
    if (err instanceof DocxPdfConvertNotConfiguredError) {
      return NextResponse.json({ error: err.message, code: 'convert_not_configured' }, { status: 501 })
    }
    if (err instanceof DocxPdfConvertError) {
      return NextResponse.json({ error: err.message, code: 'convert_failed' }, { status: err.status })
    }
    console.error('[convert-pdf]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Conversion failed' },
      { status: 500 },
    )
  }
}
