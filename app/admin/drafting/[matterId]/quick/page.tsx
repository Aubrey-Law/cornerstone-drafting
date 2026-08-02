import { notFound } from 'next/navigation'
import { fetchMatter } from '@/lib/queries'
import QuickDraftPage from './QuickDraftPage'

export const dynamic = 'force-dynamic'

export default async function QuickDraftRoute({
  params,
}: {
  params: Promise<{ matterId: string }>
}) {
  const { matterId } = await params
  const matter = await fetchMatter(matterId)
  if (!matter) notFound()

  const label = matter.client_name || matter.matter_name || 'this matter'
  return <QuickDraftPage matterId={matterId} matterLabel={label} />
}
