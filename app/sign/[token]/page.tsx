import { SigningExperience } from '@/components/esign/SigningExperience'

export const dynamic = 'force-dynamic'

/**
 * The public signing page.
 *
 * Deliberately outside proxy.ts's matcher, so no session is required — the
 * token in the URL is the credential and /api/sign/[token] verifies it. The
 * page itself holds nothing sensitive: it renders the client component, which
 * fetches the document through that same verified route. A client signed in to
 * the portal has a second door to the same flow, /documents/sign/[sessionId].
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SigningExperience endpoint={`/api/sign/${encodeURIComponent(token)}`} />
}
