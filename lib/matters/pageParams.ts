import { MATTER_SORT_KEYS, MATTER_STAGE_GROUPS, matterTableFiltersFrom, type MatterSortKey, type MatterTableFilters } from '@/lib/adminTables/matterTable'
import { pageRequest, type PageRequest } from '@/lib/queries/page'
import type { StageGroup } from '@/types/database'
export type MatterPageParams = PageRequest & { filters: MatterTableFilters; sort: MatterSortKey; view:'table'|'board'; card:'attention'|'signing'|null; groupPages:Record<StageGroup,number> }
export function matterPageParams(params:Record<string,string|string[]|undefined>):MatterPageParams {
  const get=(key:string)=>typeof params[key]==='string' ? params[key] as string : undefined
  const sort=get('sort') ?? 'last_activity', stage=get('stage') ?? 'all', card=get('card') ?? '', view=get('view') ?? 'table'
  if (!MATTER_SORT_KEYS.includes(sort as MatterSortKey) || !['all',...MATTER_STAGE_GROUPS].includes(stage) || !['','attention','signing'].includes(card) || !['table','board'].includes(view)) throw new Error('Invalid matter filter')
  const filters=matterTableFiltersFrom({search:get('search'),practice:get('practice'),stage})
  if(filters.search.length>200 || filters.practice.length>100) throw new Error('Matter filter is too long')
  const groupPages=Object.fromEntries(MATTER_STAGE_GROUPS.map(group=>[group,pageRequest({page:get(`page_${group}`)}).page])) as Record<StageGroup,number>
  return {...pageRequest({page:get('page'),pageSize:get('pageSize')}),filters,sort:sort as MatterSortKey,view:view as 'table'|'board',card:card ? card as 'attention'|'signing' : null,groupPages}
}
