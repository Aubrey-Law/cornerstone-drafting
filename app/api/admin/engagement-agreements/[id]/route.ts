import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { engagementService } from '@/lib/engagement/runtime'

type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, { params }: Context) { try { await requireEngagementStaff(); return Response.json(await getScopedAgreement((await params).id)) } catch (e) { return engagementHttpError(e) } }
export async function PATCH(request: Request, { params }: Context) { try { await requireEngagementStaff(); const id=(await params).id; await getScopedAgreement(id); const result=await (await engagementService()).previewAgreement(id, await request.json()); return Response.json({ revision: result.revision }) } catch (e) { return engagementHttpError(e) } }
