import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { engagementService } from '@/lib/engagement/runtime'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, { params }: Context) { try { const auth=await requireEngagementStaff(); const id=(await params).id; await getScopedAgreement(id); const body=await request.json(); if(body.confirmExactRevision !== true) throw new Error('Exact revision confirmation is required'); return Response.json(await engagementService().sendApprovedAgreement({ agreementId:id, approvalToken:body.approvalToken, sentBy:auth.id })) } catch(e) { return engagementHttpError(e) } }
