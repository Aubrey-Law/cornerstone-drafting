'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { BookOpen, FileText, MessageSquare, Plus, RefreshCw, Search, Table2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentTemplatesSection } from '@/app/admin/settings/DocumentTemplatesSection'
import type { WorkSkill } from '@/components/works/types'
import { WorkflowDetail } from './components/WorkflowDetail'
import { TemplateBuilderLauncher } from './components/TemplateBuilderLauncher'
import { SkillEditorDialog } from './components/SkillEditorDialog'
import { ShareSkillDialog } from './components/ShareSkillDialog'
import { AdminPageShell } from '@/components/layout/AdminPageShell'

const starterSkill = `---
name: My New Workflow
description: Describe what this workflow reviews, drafts, or analyzes
version: 1.0.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - Massachusetts
allowed_context:
  - matter
  - documents
---

Review only approved matter facts. Identify missing information as [UNKNOWN]. Draft next steps for attorney review; do not change the matter record.`

const SCOPES = ['all', 'mine', 'shared', 'system', 'inactive'] as const

export default function WorksClient() {
  const searchParams = useSearchParams()
  const [skills, setSkills] = useState<WorkSkill[]>([])
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('all')
  const [type, setType] = useState('')
  const [practice, setPractice] = useState('')
  const [query, setQuery] = useState(() => searchParams.get('search') ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSkill, setEditorSkill] = useState<WorkSkill | null>(null)
  const [shareSkill, setShareSkill] = useState<WorkSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ scope })
    if (type) params.set('type', type)
    const response = await fetch(`/api/admin/works?${params.toString()}`, { cache: 'no-store' })
    const body = await response.json().catch(() => ({})) as { skills?: WorkSkill[]; error?: string }
    if (response.ok) setSkills(body.skills ?? [])
    else toast.error(body.error ?? 'Unable to load the library')
    setLoading(false)
  }, [scope, type])

  useEffect(() => { void loadSkills() }, [loadSkills])

  const practices = useMemo(() => {
    return [...new Set(skills.map(skill => skill.practice ?? 'General'))].sort()
  }, [skills])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return skills
      .filter(skill => !practice || (skill.practice ?? 'General') === practice)
      .filter(skill => !normalized ||
        `${skill.name} ${skill.description} ${skill.practice ?? ''}`.toLowerCase().includes(normalized))
  }, [query, practice, skills])

  const selected = useMemo(
    () => skills.find(skill => skill.id === selectedId) ?? null,
    [skills, selectedId],
  )

  async function saveSkill(skillMd: string) {
    setSaving(true)
    const response = await fetch(editorSkill ? `/api/admin/works/${editorSkill.id}` : '/api/admin/works', {
      method: editorSkill ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillMd }),
    })
    const body = await response.json().catch(() => ({})) as { skill?: WorkSkill; error?: string }
    setSaving(false)
    if (!response.ok) {
      toast.error(body.error ?? 'Unable to save skill')
      return
    }
    setEditorOpen(false)
    if (body.skill) setSelectedId(body.skill.id)
    toast.success('Skill saved')
    await loadSkills()
  }

  async function syncSystemSkills() {
    setSyncing(true)
    const response = await fetch('/api/admin/works/sync-system', { method: 'POST' })
    const body = await response.json().catch(() => ({})) as {
      result?: { created: string[]; updated: string[]; unchanged: string[]; deactivated: string[] }
      error?: string
    }
    setSyncing(false)
    if (!response.ok || !body.result) {
      toast.error(body.error ?? 'System skill sync failed')
      return
    }
    const { created, updated, deactivated, unchanged } = body.result
    if (created.length + updated.length + deactivated.length === 0) {
      toast.success(`System skills already up to date (${unchanged.length} unchanged)`)
    } else {
      toast.success(`System skills synced: ${created.length} added, ${updated.length} updated, ${deactivated.length} retired`)
    }
    await loadSkills()
  }

  return (
    <AdminPageShell className="overflow-auto">
      <PageHeader
        eyebrow="Attorney tools"
        icon={BookOpen}
        title="Library"
        description="Reusable workflows for drafting, review, and structured matter work — plus the firm's document masters."
        actions={
          <>
            <Button type="button" variant="outline" disabled={syncing} onClick={() => void syncSystemSkills()}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sync system skills
            </Button>
            <Button type="button" onClick={() => { setEditorSkill(null); setEditorOpen(true) }}>
              <Plus className="h-4 w-4" /> New workflow
            </Button>
          </>
        }
      />

      <Tabs defaultValue="workflows" className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="documents">Document masters</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
            {SCOPES.map(item => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={scope === item ? 'secondary' : 'ghost'}
                onClick={() => setScope(item)}
              >
                {item === 'all' ? 'All active' : item[0].toUpperCase() + item.slice(1)}
              </Button>
            ))}
            <select
              value={type}
              onChange={event => setType(event.target.value)}
              className="ml-auto rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">All types</option>
              <option value="assistant">Assistant</option>
              <option value="tabular">Tabular</option>
            </select>
            <select
              value={practice}
              onChange={event => setPractice(event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">All practices</option>
              {practices.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
              <Search className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search workflows"
                className="w-40 bg-transparent outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {loading ? (
                <p className="p-8 text-sm text-muted-foreground">Loading workflows…</p>
              ) : filtered.length === 0 ? (
                <div className="p-10 text-center">
                  <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-3 text-sm font-medium">No workflows in this view</p>
                  <p className="mt-1 text-xs text-muted-foreground">Create a workflow, sync system skills, or change the filters.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map(skill => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setSelectedId(skill.id)}
                      className={`flex w-full items-start gap-3 p-4 text-left hover:bg-muted/50 ${selected?.id === skill.id ? 'bg-muted/60' : ''}`}
                    >
                      <span className="mt-0.5 rounded-md bg-primary/10 p-2">
                        {skill.skill_type === 'tabular' ? <Table2 className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{skill.name}</span>
                          {skill.is_system && <Badge variant="secondary" className="text-[10px]">System</Badge>}
                          {skill.is_shared && <Badge variant="secondary" className="text-[10px]">Shared</Badge>}
                          {!skill.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">{skill.description}</span>
                        <span className="mt-2 block text-xs text-muted-foreground">
                          {skill.practice ?? 'General'} · {skill.execution_mode} · v{skill.version}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <WorkflowDetail
              skill={selected}
              onEdit={skill => { setEditorSkill(skill); setEditorOpen(true) }}
              onShare={skill => setShareSkill(skill)}
              onChanged={loadSkills}
            />
          </div>
        </TabsContent>

        <TabsContent value="documents" className="min-h-0 flex-1">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-4 flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                The Word masters behind document generation. Upload a new version, validate it against a matter, then publish —
                generation always uses the published (or bundled) master.
              </p>
            </div>
            <TemplateBuilderLauncher skills={skills} />
            <DocumentTemplatesSection />
          </div>
        </TabsContent>
      </Tabs>

      <SkillEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={editorSkill ? 'Edit workflow' : 'New workflow'}
        initialValue={editorSkill?.skill_md ?? starterSkill}
        saving={saving}
        onSave={value => void saveSkill(value)}
      />
      <ShareSkillDialog skill={shareSkill} onOpenChange={open => { if (!open) setShareSkill(null) }} />
    </AdminPageShell>
  )
}
