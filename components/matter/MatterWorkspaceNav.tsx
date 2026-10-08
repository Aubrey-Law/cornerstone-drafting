'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { useMatterWorkspaceContext } from '@/lib/matters/WorkspaceContext'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { WORKSPACE_TAB_CLASS, WORKSPACE_TAB_TRIGGER_CLASS, WORKSPACE_TABS_LIST_CLASS, WorkspaceTabCount } from '@/components/workspace/RecordWorkspaceHeader'
import { MATTER_WORKSPACE_SECTIONS, matterWorkspaceHref, type MatterWorkspaceSection } from '@/lib/matters/workspace'

const LINK_CLASS = WORKSPACE_TAB_CLASS

export function MatterWorkspaceNav({ matterId, active, onSelect, drafting = true, counts = {} }: {
  matterId: string
  active: string
  onSelect?: (section: MatterWorkspaceSection) => void
  drafting?: boolean
  counts?: Partial<Record<MatterWorkspaceSection, number>>
}) {
  const setMatterId = useMatterWorkspaceContext()?.setMatterId
  useEffect(() => {
    setMatterId?.(matterId)
    return () => setMatterId?.(null)
  }, [matterId, setMatterId])
  const links = MATTER_WORKSPACE_SECTIONS
    .filter(([section]) => drafting || section !== 'drafting')
    .map(([section, label]) => {
      const content = <>{label}{Boolean(counts[section]) && <WorkspaceTabCount count={counts[section]!} />}</>
      if (onSelect && section !== 'drafting') {
        return <TabsTrigger key={section} value={section} className={cn(LINK_CLASS, WORKSPACE_TAB_TRIGGER_CLASS)}>{content}</TabsTrigger>
      }
      return <Link key={section} href={matterWorkspaceHref(matterId, section)} aria-current={active === section ? 'page' : undefined}
        className={cn(LINK_CLASS, active === section && 'border-selected-border font-medium text-selected-foreground')}>{content}</Link>
    })
  return <nav aria-label="Matter workspace" className="w-full min-w-0 overflow-x-auto bg-card px-4 md:px-6">
    {onSelect
      ? <TabsList className={WORKSPACE_TABS_LIST_CLASS}>{links}</TabsList>
      : <div className="flex w-max flex-nowrap gap-0.5">{links}</div>}
  </nav>
}
