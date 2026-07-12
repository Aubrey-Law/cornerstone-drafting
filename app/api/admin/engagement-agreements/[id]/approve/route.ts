import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { engagementService } from '@/lib/engagement/runtime'
type Context = { params: Promise<{ id: string }> }
export async function POST(_request: Request, { params }: Context) { try { await requireEngagementStaff(); const id=(await params).id; await getScopedAgreement(id); return Response.json({ approvalToken: await engagementService().approveAgreementRevision(id) }) } catch(e) { return engagementHttpError(e) } }
