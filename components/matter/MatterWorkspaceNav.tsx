'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { useMatterWorkspaceContext } from '@/lib/matters/WorkspaceContext'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { MATTER_WORKSPACE_SECTIONS, matterWorkspaceHref, type MatterWorkspaceSection } from '@/lib/matters/workspace'

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
  const links = MATTER_WORKSPACE_SECTIONS.filter(([section]) => drafting || section !== 'drafting').map(([section, label]) => {
    const content = <>{label}{Boolean(counts[section]) && <span className="ml-1 rounded bg-muted px-1 text-xs">{counts[section]}</span>}</>
    // Preserve Radix trigger/content relationships on the detail page. Drafting
    // is a route; the other sections are panels in its controlled Tabs root.
    if (onSelect && section !== 'drafting') return <TabsTrigger key={section} value={section} className="shrink-0">{content}</TabsTrigger>
    return <Link key={section} href={matterWorkspaceHref(matterId, section)} aria-current={active === section ? 'page' : undefined}
      onClick={event => { if (onSelect && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(section) } }}
      className={cn('shrink-0 rounded-md px-3 py-2 text-sm hover:bg-accent', active === section && 'bg-selected font-medium text-selected-foreground')}>{content}</Link>
  })
  return <nav aria-label="Matter workspace" className="w-full overflow-x-auto border-b bg-background py-2">
    {onSelect ? <TabsList className="h-auto w-max justify-start">{links}</TabsList> : <div className="flex w-max gap-1">{links}</div>}
  </nav>
}
