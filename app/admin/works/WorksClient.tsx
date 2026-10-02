'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { BookOpen, FileText, MessageSquare, Plus, RefreshCw, Search, Table2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentTemplatesSection } from '@/app/admin/settings/DocumentTemplatesSection'
import { EmailTemplatesSection } from '@/app/admin/settings/EmailTemplatesSection'
import { EsignTemplateEditor } from '@/app/admin/settings/EsignTemplateEditor'
import { EstateClauseLibrarySection } from '@/app/admin/settings/estate-clauses/EstateClauseLibrarySection'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
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

/**
 * Library tabs. Everything after Workflows is a firm template and
 * administrator-only, since every endpoint behind those editors is. The
 * templates share one "Templates" section with its own sub-navigation, so the
 * top row stays two entries wide on a phone.
 */
const LIBRARY_TABS = [
  { value: 'workflows', label: 'Workflows', adminOnly: false },
  { value: 'documents', label: 'Document masters', adminOnly: true },
  { value: 'email-templates', label: 'Email', adminOnly: true },
  { value: 'esign', label: 'E-signature layout', adminOnly: true },
  { value: 'clauses', label: 'Clause library', adminOnly: true },
] as const

type LibraryTab = (typeof LIBRARY_TABS)[number]['value']

const TEMPLATE_TABS = LIBRARY_TABS.filter(t => t.adminOnly)

interface WorksClientProps {
  /** Firm templates are administrator-only; attorneys see why, not a failure. */
  canManageMasters?: boolean
  currentUserId?: string
}

export default function WorksClient({ canManageMasters = false, currentUserId = '' }: WorksClientProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const token = useAccessToken()
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined
  const visibleTabs = LIBRARY_TABS.filter(t => !t.adminOnly || canManageMasters)
  const requestedTab = searchParams.get('tab')
  const tab: LibraryTab = visibleTabs.find(t => t.value === requestedTab)?.value ?? 'workflows'
  // Kept in the URL so Settings and other pages can link straight to a template editor.
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'workflows') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)
  const section = tab === 'workflows' ? 'workflows' : 'templates'

  // On a phone the preview sits below the whole list; bring it into view.
  const selectSkill = (id: string) => {
    setSelectedId(id)
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  const loadSkills = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ scope })
    if (type) params.set('type', type)
    try {
      const response = await fetch(`/api/admin/works?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { skills?: WorkSkill[]; error?: string }
      if (response.ok) {
        setSkills(body.skills ?? [])
        setLoadError(null)
      } else {
        const message = body.error ?? 'Unable to load the library'
        setLoadError(message)
        toast.error(message)
      }
    } catch {
      setLoadError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [scope, type])

  useEffect(() => { void loadSkills() }, [loadSkills])

  const practices = useMemo(() => {
    return [...new Set(skills.map(skill => skill.practice ?? 'General'))].sort()
  }, [skills])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return skills
      .filter(skill => !practice || (skill.practice ?? 'General') === practice)
      // Slug is searchable so a deep link can name a skill exactly — the billing
      // dashboard's "claim not prepared" nudge links to ?search=metlife-claim.
      .filter(skill => !normalized ||
        `${skill.name} ${skill.description} ${skill.practice ?? ''} ${skill.slug ?? ''}`.toLowerCase().includes(normalized))
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
    <AdminPageShell>
      <PageHeader
        eyebrow="Attorney tools"
        icon={BookOpen}
        title="Library"
        description={canManageMasters
          ? "Reusable workflows for drafting, review, and structured matter work — plus the firm's document, email, e-signature, and clause templates."
          : 'Reusable workflows for drafting, review, and structured matter work.'}
      />

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-4">
        {/* Attorneys only ever see Workflows, so there is nothing to switch between. */}
        {canManageMasters && (
          <div className="flex flex-col gap-2">
            <div role="tablist" aria-label="Library section" className="inline-flex w-fit rounded-lg bg-muted p-1">
              {(['workflows', 'templates'] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={section === item}
                  onClick={() => {
                    if (item === 'workflows') setTab('workflows')
                    else if (section !== 'templates') setTab(TEMPLATE_TABS[0].value)
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium',
                    section === item ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item === 'workflows' ? 'Workflows' : 'Templates'}
                </button>
              ))}
            </div>
            {section === 'templates' && (
              <TabsList className="h-auto w-fit max-w-full flex-wrap justify-start">
                {TEMPLATE_TABS.map(t => (
                  <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
                ))}
              </TabsList>
            )}
          </div>
        )}

        <TabsContent value="workflows" className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search workflows"
                aria-label="Search workflows"
                className="w-full bg-transparent text-foreground outline-none"
              />
            </label>
            <select
              value={type}
              onChange={event => setType(event.target.value)}
              aria-label="Workflow type"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All types</option>
              <option value="assistant">Assistant</option>
              <option value="tabular">Tabular</option>
            </select>
            <select
              value={practice}
              onChange={event => setPractice(event.target.value)}
              aria-label="Practice area"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All practices</option>
              {practices.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className="flex gap-2 sm:ml-auto">
              <Button type="button" variant="outline" disabled={syncing} onClick={() => void syncSystemSkills()}>
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sync system skills
              </Button>
              <Button type="button" onClick={() => { setEditorSkill(null); setEditorOpen(true) }}>
                <Plus className="h-4 w-4" /> New workflow
              </Button>
            </div>
          </div>

          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
                {SCOPES.map(item => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={scope === item ? 'secondary' : 'ghost'}
                    aria-pressed={scope === item}
                    onClick={() => setScope(item)}
                  >
                    {item === 'all' ? 'All active' : item[0].toUpperCase() + item.slice(1)}
                  </Button>
                ))}
                {!loading && !loadError && (
                  <span className="ml-auto px-2 text-xs text-muted-foreground">
                    {filtered.length} {filtered.length === 1 ? 'workflow' : 'workflows'}
                  </span>
                )}
              </div>
              {loading ? (
                <p className="p-8 text-sm text-muted-foreground">Loading workflows…</p>
              ) : loadError ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium text-destructive">The library could not be loaded</p>
                  <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => void loadSkills()}>Try again</Button>
                </div>
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
                      onClick={() => selectSkill(skill.id)}
                      aria-current={selected?.id === skill.id ? 'true' : undefined}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent ${selected?.id === skill.id ? 'bg-selected' : ''}`}
                    >
                      <span className="mt-0.5 rounded-md bg-primary/10 p-2">
                        {skill.skill_type === 'tabular' ? <Table2 className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{skill.name}</span>
                          {skill.is_system && <Badge variant="secondary" className="text-micro">System</Badge>}
                          {skill.is_shared && <Badge variant="secondary" className="text-micro">Shared</Badge>}
                          {!skill.is_active && <Badge variant="destructive" className="text-micro">Inactive</Badge>}
                        </span>
                        <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{skill.description}</span>
                        <span className="mt-1.5 block text-xs text-muted-foreground">
                          {skill.practice ?? 'General'} · {skill.execution_mode} · v{skill.version}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sticky on wide screens so the preview stays beside the row you
                picked, however far down the list it is. */}
            <div
              ref={detailRef}
              className="min-w-0 scroll-mt-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto"
            >
              <WorkflowDetail
                skill={selected}
                onEdit={skill => { setEditorSkill(skill); setEditorOpen(true) }}
                onShare={skill => setShareSkill(skill)}
                onChanged={loadSkills}
              />
            </div>
          </div>
        </TabsContent>

        {canManageMasters && <TabsContent value="documents" className="min-h-0 flex-1">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-4 flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                The Word masters behind document generation. An upload stays staged until you publish it; validating it
                against a matter first is optional. Generation always uses the published (or bundled) master.
              </p>
            </div>
            <TemplateBuilderLauncher skills={skills} />
            <DocumentTemplatesSection />
          </div>
        </TabsContent>}

        {canManageMasters && <TabsContent value="email-templates" className="min-h-0 flex-1">
          {/* Its list and editor are cards of their own; no outer frame. */}
          <EmailTemplatesSection authHeaders={authHeaders} />
        </TabsContent>}

        {canManageMasters && <TabsContent value="esign" className="min-h-0 flex-1">
          {/* No outer frame: the embedded editor needs the full width. */}
          <EsignTemplateEditor />
        </TabsContent>}

        {canManageMasters && <TabsContent value="clauses" className="min-h-0 flex-1">
          <div className="rounded-lg border border-border bg-card p-4">
            <EstateClauseLibrarySection currentUserId={currentUserId} />
          </div>
        </TabsContent>}
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
