import { NextResponse } from 'next/server'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { requireAdmin } from '@/lib/apiAuth'
import { convertDocxBufferToPdf, pdfFilenameFromDocx } from '@/lib/docxToPdf'
import { isWordDocument } from '@/lib/documents'
import { mirrorMatterDocumentToOneDrive } from '@/lib/oneDriveSync'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { resolveMatterId } from '@/lib/buildDraftPayload'
import { auditDocumentAccess } from '@/lib/documentSecurity'

type Params = { params: Promise<{ id: string; docId: string }> }

const PDF_CONTENT_TYPE = 'application/pdf'

export async function POST(req: Request, { params }: Params) {
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterRef, docId } = await params
  const body = await req.json().catch(() => ({})) as { toFolder?: string }
  const toFolder = body.toFolder === 'signed' || body.toFolder === 'final' ? body.toFolder : 'review'

  try {
    const matterId = await resolveMatterId(matterRef)
    const admin = getAdminClient()

    const { data: source, error: loadError } = await admin
      .from('matter_documents')
      .select(MATTER_DOCUMENT_COLUMNS)
      .eq('id', docId)
      .eq('matter_id', matterId)
      .maybeSingle()

    if (loadError || !source) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (!isWordDocument(source.name, source.content_type)) {
      return NextResponse.json(
        { error: 'Only internal Word drafts can be converted. Upload a PDF to share instead.', code: 'not_word_draft' },
        { status: 409 },
      )
    }

    const r2 = getR2Client()
    const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: source.r2_key }))
    const docxBytes = new Uint8Array(await object.Body!.transformToByteArray())
    const pdfBytes = await convertDocxBufferToPdf(docxBytes, source.name)
    const pdfName = pdfFilenameFromDocx(source.name)

    const timestamp = Date.now()
    const safeFilename = pdfName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const r2Key = `matters/${matterId}/${toFolder}/${timestamp}-${safeFilename}`

    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: pdfBytes,
      ContentType: PDF_CONTENT_TYPE,
    }))

    const reviewedAt = new Date().toISOString()
    const { data: shared, error: insertError } = await admin
      .from('matter_documents')
      .insert({
        matter_id: matterId,
        r2_key: r2Key,
        name: pdfName,
        size: pdfBytes.byteLength,
        content_type: PDF_CONTENT_TYPE,
        folder: toFolder,
        folder_id: null,
        uploaded_by: user.id,
        reviewed_at: reviewedAt,
        reviewed_by: user.id,
        marker_count: 0,
        missing_count: 0,
      })
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()

    if (insertError || !shared) {
      return NextResponse.json({ error: insertError?.message ?? 'Failed to save shared PDF' }, { status: 500 })
    }

    const audit = await auditDocumentAccess(admin, user, shared, 'folder_change', {
      from_folder: source.folder,
      to_folder: toFolder,
      promotion_to_client_visible: true,
      converted_from_document_id: source.id,
      converted_from_name: source.name,
      document_name: shared.name,
      route: '/api/admin/matters/[id]/documents/[docId]/share-pdf',
    })
    if (!audit.ok) {
      await admin.from('matter_documents').delete().eq('id', shared.id)
      return NextResponse.json({ error: 'Audit log write failed; share reverted' }, { status: 500 })
    }

    mirrorMatterDocumentToOneDrive({
      matterDocumentId: shared.id,
      matterId,
      r2Key,
      fileName: pdfName,
      folder: toFolder,
    }).catch(err => console.error('[onedrive] mirror shared PDF', err))

    return NextResponse.json({ document: shared, sourceDocumentId: source.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'PDF conversion failed'
    console.error('[share-pdf]', matterRef, docId, e)
    return NextResponse.json(
      {
        error: message.includes('OneDrive') || message.includes('Graph')
          ? 'PDF conversion requires Microsoft 365 / OneDrive. Export a PDF from Word and upload it instead.'
          : message,
        code: 'conversion_failed',
      },
      { status: 500 },
    )
  }
}
