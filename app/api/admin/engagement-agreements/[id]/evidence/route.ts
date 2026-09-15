import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { engagementArtifactUrl } from '@/lib/engagement/postSend'
import type { EsignArtifactKind } from '@/lib/esign/types'

type Context = { params: Promise<{ id: string }> }

const ARTIFACT_KINDS: EsignArtifactKind[] = ['signed_pdf', 'audit_certificate', 'combined_evidence']

/** GET ?kind=combined_evidence → a short-lived download URL. */
export async function GET(request: Request, { params }: Context) {
  try {
    await requireEngagementStaff()
    const id = (await params).id
    await getScopedAgreement(id)
    const kind = new URL(request.url).searchParams.get('kind')
    if (!kind || !ARTIFACT_KINDS.includes(kind as EsignArtifactKind)) {
      throw new Error('A valid evidence kind is required')
    }
    return Response.json(await engagementArtifactUrl({ agreementId: id, kind: kind as EsignArtifactKind }))
  } catch (e) { return engagementHttpError(e) }
}
