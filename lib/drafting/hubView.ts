import type { HubActionFilter, HubSortKey } from './hubUtils'

export interface HubView {
  search: string
  sort: HubSortKey
  action: HubActionFilter
  practice: string
}
export interface SavedHubView extends HubView { name: string }
export const DEFAULT_HUB_VIEW: HubView = { search: '', sort: 'updated', action: 'all', practice: 'all' }
export const HUB_RETURN_KEY = 'cornerstone.drafting.worklist-return'

export function parseHubView(params: URLSearchParams): HubView {
  const sort = params.get('sort')
  const action = params.get('action')
  return {
    search: (params.get('search') ?? '').slice(0, 300),
    sort: sort === 'client' || sort === 'action' ? sort : 'updated',
    action: ['design', 'setup', 'generate', 'review', 'revise', 'quiet'].includes(action ?? '') ? action as HubActionFilter : 'all',
    practice: (params.get('practice') || 'all').slice(0, 100),
  }
}

export function hubViewUrl(view: HubView): string {
  const params = new URLSearchParams({ view: 'all' })
  if (view.search) params.set('search', view.search)
  if (view.sort !== 'updated') params.set('sort', view.sort)
  if (view.action !== 'all') params.set('action', view.action)
  if (view.practice !== 'all') params.set('practice', view.practice)
  return `/admin/drafting?${params}`
}

export function parseSavedHubViews(raw: unknown): SavedHubView[] {
  if (!Array.isArray(raw)) return []
  const names = new Set<string>()
  return raw.flatMap(value => {
    if (!value || typeof value !== 'object' || typeof value.name !== 'string') return []
    const name = value.name.trim().slice(0, 60)
    if (!name || names.has(name)) return []
    names.add(name)
    const params = new URLSearchParams()
    for (const key of ['search', 'sort', 'action', 'practice']) {
      if (typeof value[key] === 'string') params.set(key, value[key])
    }
    return [{ name, ...parseHubView(params) }]
  }).slice(0, 20)
}

/** Pagination is URL/return-position state, not part of a named saved filter. */
export interface HubPageQuery extends HubView { page: number }
export const HUB_PAGE_SIZE = 50
export function parseHubPage(params: URLSearchParams): HubPageQuery {
  const page = Number(params.get('page') ?? 1)
  return { ...parseHubView(params), page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1 }
}
export function hubPageUrl(query: HubPageQuery): string {
  return `${hubViewUrl(query)}${query.page > 1 ? `&page=${query.page}` : ''}`
}
