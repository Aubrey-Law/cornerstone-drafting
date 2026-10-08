'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  type AssetView,
  type CommunicationChannel,
  type DocumentView,
  type MatterTab,
  parseAssetView,
  parseCommunicationChannel,
  parseDocumentView,
  parseMatterTab,
  parseTaskView,
  type TaskView,
} from '@/lib/matterPageTabs'

export type DocumentScope = 'all' | 'unreviewed' | 'shared' | 'client'

/**
 * The matter workspace's URL state: `?tab=`, each tab's `?view=` face,
 * `?channel=` on Messages, and `?scope=` / `?document=` on Documents.
 */
export function useMatterTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = parseMatterTab(searchParams.get('tab'))
  const communicationChannel = parseCommunicationChannel(searchParams.get('channel'))
  // The Tasks tab's two faces. `?tab=sla` from an older link resolves to
  // `tasks`, so plan links keep working; `?view=plan` opens the plan directly.
  const taskView = parseTaskView(searchParams.get('view'))
  // Assets' inventory or funding, Documents' files or signing — `?view=` on
  // those tabs, the same parameter the Tasks tab uses.
  const assetView = parseAssetView(activeTab === 'assets' ? searchParams.get('view') : null)
  const documentView = parseDocumentView(activeTab === 'documents' ? searchParams.get('view') : null)
  const scopeParam = searchParams.get('scope')
  const documentScope: DocumentScope = scopeParam === 'unreviewed' || scopeParam === 'shared' || scopeParam === 'client' ? scopeParam : 'all'
  const deepLinkedDocumentId = searchParams.get('document')

  const replace = useCallback((params: URLSearchParams) => {
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router])

  const setActiveTab = useCallback((
    tab: MatterTab,
    section?: string,
    channel?: CommunicationChannel,
    scope?: 'unreviewed',
  ) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'overview') {
      params.delete('tab')
      params.delete('channel')
    } else {
      params.set('tab', tab)
      if (tab === 'communications') {
        params.set('channel', channel ?? communicationChannel)
      } else {
        params.delete('channel')
      }
      if (tab !== 'tasks') params.delete('view')
    }
    if (tab !== 'documents') { params.delete('scope'); params.delete('document') }
    else if (scope) { params.set('scope', scope); params.delete('document') }
    replace(params)
    if (section) {
      requestAnimationFrame(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [communicationChannel, replace, searchParams])

  const setTaskView = useCallback((view: TaskView) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'tasks')
    if (view === 'queue') params.delete('view')
    else params.set('view', view)
    replace(params)
  }, [replace, searchParams])

  /** Switches the face of the current tab; the default face drops `?view=`. */
  const setTabView = useCallback((tab: 'assets' | 'documents', view: AssetView | DocumentView, defaultView: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    if (view === defaultView) params.delete('view')
    else params.set('view', view)
    if (tab === 'documents') { params.delete('scope'); params.delete('document') }
    replace(params)
  }, [replace, searchParams])

  const setDocumentScope = useCallback((scope: DocumentScope) => {
    const params = new URLSearchParams(searchParams.toString())
    if (scope === 'all') params.delete('scope')
    else params.set('scope', scope)
    params.delete('document')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams])

  return {
    activeTab, communicationChannel, taskView, assetView, documentView, documentScope, deepLinkedDocumentId,
    setActiveTab, setTaskView, setTabView, setDocumentScope,
  }
}
