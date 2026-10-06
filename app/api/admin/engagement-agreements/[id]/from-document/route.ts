import { reviseEngagementFromDocument } from '@/lib/engagement/editableDocument'
import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

/**
 * POST — make the agreement's editable document, as edited in the viewer or in
 * Word, the next signing revision. Answers in the preview route's shape so the
 * workspace treats it like a fresh generate.
 */
export async function POST(_request: Request, { params }: Context) {
  try {
    await requireEngagementStaff()
    const agreement = await getScopedAgreement((await params).id)
    const result = await reviseEngagementFromDocument(getAdminClient(), agreement)
    return Response.json({
      revision: result.revision,
      sha256: result.sha256,
      docxBase64: result.docx.toString('base64'),
      pdfBase64: result.pdf.toString('base64'),
      documentVersionId: result.documentVersionId,
    })
  } catch (e) {
    return engagementHttpError(e)
  }
}
