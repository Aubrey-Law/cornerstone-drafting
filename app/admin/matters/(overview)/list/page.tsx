import { fetchMatterPage } from '@/lib/queries/matters'
import { matterPageParams } from '@/lib/matters/pageParams'
import MattersClient from '../../MattersClient'
export const dynamic = 'force-dynamic'
export default async function MattersPage({ searchParams }: { searchParams:Promise<Record<string,string|string[]|undefined>> }) {
  const params=matterPageParams(await searchParams)
  const result=await fetchMatterPage(params)
  return <MattersClient matters={result.rows} pagination={{...result,params:{...params,page:result.page}}} />
}
