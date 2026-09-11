import { redirect } from 'next/navigation'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { fetchDraftingHubMatters } from '@/lib/queries/drafting'
import { parseHubPage } from '@/lib/drafting/hubView'
import DraftingHubClient from './DraftingHubClient'

export const dynamic = 'force-dynamic'

export default async function DraftingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // A layout can render concurrently with its page: authorize before the
  // service-role query, even though the admin layout has its own gate.
  const user = await getCachedClaims()
  if (!user) redirect('/auth/login')
  const role = await getCachedUserRole(user.id)
  if (role !== 'attorney' && role !== 'admin') redirect('/auth/login')
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value)
  }
  const query = parseHubPage(params)
  const result = await fetchDraftingHubMatters(query)
  return <DraftingHubClient result={result} query={{ ...query, page: result.page }} />
}
