'use client'

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, Search, Table2 } from 'lucide-react'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { skillBody, type WorkSkill } from '@/components/works/types'

interface WorkflowPickerContentProps {
  /** Restrict to one skill type (the assistant composer attaches assistant skills only). */
  typeFilter?: 'assistant' | 'tabular'
  /**
   * Restrict to one execution mode. The chat composer passes 'chat': a
   * run-mode workflow needs the Library's dedicated run (matter snapshot,
   * deterministic assembly) and cannot do its job from a message.
   */
  executionMode?: 'chat' | 'run'
  onPick: (skill: WorkSkill) => void
  pickLabel?: string
}

/**
 * Searchable two-pane workflow picker (list + Markdown preview), modeled on
 * Mike OSS's WorkflowPickerContent. Fetches the caller-visible skills itself.
 */
export function WorkflowPickerContent({ typeFilter, executionMode, onPick, pickLabel = 'Use workflow' }: WorkflowPickerContentProps) {
  const [skills, setSkills] = useState<WorkSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | 'system' | 'custom'>('all')
  const [selected, setSelected] = useState<WorkSkill | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const params = new URLSearchParams({ scope: 'all' })
      if (typeFilter) params.set('type', typeFilter)
      const response = await fetch(`/api/admin/works?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { skills?: WorkSkill[]; error?: string }
      if (cancelled) return
      if (response.ok) setSkills(body.skills ?? [])
      else setError(body.error ?? 'Unable to load workflows')
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [typeFilter])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return skills
      .filter(skill => skill.is_active)
      .filter(skill => !executionMode || skill.execution_mode === executionMode)
      .filter(skill => source === 'all' ? true : source === 'system' ? skill.is_system : !skill.is_system)
      .filter(skill => !normalized ||
        `${skill.name} ${skill.description} ${skill.practice ?? ''}`.toLowerCase().includes(normalized))
  }, [skills, query, source, executionMode])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-md border border-border px-2 text-muted-foreground">
          <Search className="h-4 w-4 shrink-0" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search workflows"
            className="border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </label>
        {(['all', 'system', 'custom'] as const).map(item => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={source === item ? 'secondary' : 'ghost'}
            onClick={() => setSource(item)}
          >
            {item === 'all' ? 'All' : item === 'system' ? 'System' : 'Custom'}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-h-0 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading workflows…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No workflows match this view.</p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(skill => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => setSelected(skill)}
                  className={`flex w-full items-start gap-2 p-3 text-left hover:bg-accent ${selected?.id === skill.id ? 'bg-muted' : ''}`}
                >
                  <span className="mt-0.5 rounded-md bg-primary/10 p-1.5">
                    {skill.skill_type === 'tabular' ? <Table2 className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {skill.name}
                      {skill.is_system && <Badge variant="secondary" className="text-micro">System</Badge>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{skill.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-col overflow-hidden rounded-md border border-border md:flex">
          {!selected ? (
            <p className="p-6 text-sm text-muted-foreground">Select a workflow to preview its instructions.</p>
          ) : (
            <>
              <div className="border-b border-border p-3">
                <p className="text-sm font-semibold">{selected.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selected.practice ?? 'General'} · v{selected.version}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
                <ChatMarkdown content={skillBody(selected.skill_md)} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="button" disabled={!selected} onClick={() => selected && onPick(selected)}>
          {pickLabel}
        </Button>
      </div>
    </div>
  )
}
