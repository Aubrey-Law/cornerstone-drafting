import { fetchMatterPage } from '@/lib/queries/matters'
import { matterPageParams } from '@/lib/matters/pageParams'
import MattersClient from '../../MattersClient'
import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { attentionRecordIds, buildRecordWorkSummaries } from '@/lib/work/recordSummary'
export const dynamic = 'force-dynamic'
export default async function MattersPage({ searchParams }: { searchParams:Promise<Record<string,string|string[]|undefined>> }) {
  const params=matterPageParams(await searchParams)
  const auth = await getCachedClaims()
  const pagePromise = params.card === 'attention' ? null : fetchMatterPage(params)
  const graph = await fetchWorkGraphForUser(auth?.id ?? null)
  const workSummaries = buildRecordWorkSummaries(graph.items, 'matter')
  const attentionIds = attentionRecordIds(workSummaries)
  const result = pagePromise
    ? await pagePromise.then(page => ({
        ...page,
        insights: { ...page.insights, attention: attentionIds.length },
      }))
    : await fetchMatterPage(params, { attentionIds })
  return <MattersClient matters={result.rows} workSummaries={workSummaries} pagination={{...result,params:{...params,page:result.page}}} />
}
