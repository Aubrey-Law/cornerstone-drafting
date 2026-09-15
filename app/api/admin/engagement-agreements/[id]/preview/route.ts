import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { engagementService } from '@/lib/engagement/runtime'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, { params }: Context) { try { await requireEngagementStaff(); const id=(await params).id; await getScopedAgreement(id); const result=await (await engagementService()).previewAgreement(id, await request.json()); return Response.json({ revision: result.revision, sha256: result.rendered.renderSha256, masterVersion: result.rendered.masterVersion, docxBase64: result.rendered.docx?.toString('base64'), pdfBase64: result.rendered.pdf.toString('base64') }) } catch(e) { return engagementHttpError(e) } }
