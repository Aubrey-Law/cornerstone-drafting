'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { useMatterWorkspaceContext } from '@/lib/matters/WorkspaceContext'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { MATTER_WORKSPACE_SECTIONS, matterWorkspaceHref, type MatterWorkspaceSection } from '@/lib/matters/workspace'

const LINK_CLASS = 'shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'

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
      const content = <>{label}{Boolean(counts[section]) && <span className="ml-1.5 rounded bg-muted px-1.5 text-xs tabular-nums">{counts[section]}</span>}</>
      if (onSelect && section !== 'drafting') {
        return <TabsTrigger key={section} value={section} className={cn(LINK_CLASS, 'h-auto rounded-none border-0 border-b-2 data-[state=active]:border-selected-border data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-selected-foreground')}>{content}</TabsTrigger>
      }
      return <Link key={section} href={matterWorkspaceHref(matterId, section)} aria-current={active === section ? 'page' : undefined}
        className={cn(LINK_CLASS, active === section && 'border-selected-border font-medium text-selected-foreground')}>{content}</Link>
    })
  return <nav aria-label="Matter workspace" className="w-full min-w-0 overflow-x-auto bg-card px-4 md:px-6">
    {onSelect
      ? <TabsList className="h-auto w-max flex-nowrap justify-start gap-0.5 rounded-none bg-transparent p-0">{links}</TabsList>
      : <div className="flex w-max flex-nowrap gap-0.5">{links}</div>}
  </nav>
}
