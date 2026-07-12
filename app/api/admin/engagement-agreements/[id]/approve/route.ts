import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { engagementService } from '@/lib/engagement/runtime'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, { params }: Context) { try { await requireEngagementStaff(); const id=(await params).id; await getScopedAgreement(id); const body=await request.json(); return Response.json({ approvalToken: await engagementService().approveAgreementRevision({ agreementId:id, revisionId:body.revisionId, renderSha256:body.pdfSha256 }) }) } catch(e) { return engagementHttpError(e) } }
