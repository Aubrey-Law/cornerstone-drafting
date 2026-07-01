'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { stageLabel } from '@/types/database'
import type { DraftingHubMatter } from '@/lib/queries/drafting'

interface DraftingHubClientProps {
  matters: DraftingHubMatter[]
}

function readinessLabel(item: DraftingHubMatter) {
  if (!item.designSheet) return { label: 'Needs design', tone: 'warning' as const }
  if (item.setupBlockers.length > 0) return { label: 'Setup needed', tone: 'warning' as const }
  if (item.includedDocumentLabels.length === 0) return { label: 'No docs selected', tone: 'warning' as const }
  return { label: 'Ready', tone: 'success' as const }
}

export default function DraftingHubClient({ matters }: DraftingHubClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return matters
    return matters.filter(item => {
      const m = item.matter
      const haystack = [
        m.client_name, m.spouse_name, m.matter_name, m.client_email,
        m.plan_type, m.practice_area, m.stage,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [matters, search])

  const grouped = useMemo(() => {
    const ready: DraftingHubMatter[] = []
    const needsDesign: DraftingHubMatter[] = []
    const needsSetup: DraftingHubMatter[] = []
    for (const item of filtered) {
      if (!item.designSheet) needsDesign.push(item)
      else if (item.setupBlockers.length > 0 || item.includedDocumentLabels.length === 0) needsSetup.push(item)
      else ready.push(item)
    }
    return { ready, needsDesign, needsSetup }
  }, [filtered])

  const openMatter = (matterId: string) => {
    router.push(`/admin/drafting/${matterId}`)
  }

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Drafting</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pick a matter to open its drafting workspace — design, generate, and review in one flow.
        </p>
      </div>

      <div className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex max-w-md items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:border-accent">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search matters by client, matter, plan type…"
            className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matters match this search.</p>
          ) : (
            <>
              <Group title="Ready to generate" matters={grouped.ready} onOpen={openMatter} emptyHint="No matters are fully ready." />
              <Group title="Needs design sheet" matters={grouped.needsDesign} onOpen={openMatter} emptyHint="All matters have a design sheet." />
              <Group title="Setup needed" matters={grouped.needsSetup} onOpen={openMatter} emptyHint="No matters with outstanding setup." />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({
  title,
  matters,
  onOpen,
  emptyHint,
}: {
  title: string
  matters: DraftingHubMatter[]
  onOpen: (id: string) => void
  emptyHint: string
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <Badge variant="outline" className="text-[10px] tabular-nums">{matters.length}</Badge>
      </div>
      {matters.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {matters.map(item => {
            const matter = item.matter
            const readiness = readinessLabel(item)
            return (
              <button
                key={matter.matter_id}
                onClick={() => onOpen(matter.matter_id)}
                className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-accent hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold group-hover:text-accent">{matter.client_name || 'Unnamed client'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {matter.matter_name || matter.plan_type || 'Matter'} · {stageLabel(matter.stage)}
                    </p>
                  </div>
                  <Badge
                    className={cn(
                      'shrink-0 border-0 text-[10px]',
                      readiness.tone === 'success' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                    )}
                  >
                    {readiness.label}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span>{item.includedDocumentLabels.length} docs</span>
                  <span>·</span>
                  <span>{item.selectedTemplateCount} templates</span>
                  <span>·</span>
                  <span>{item.draftCount} drafts</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
