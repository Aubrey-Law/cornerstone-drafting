'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, Copy, FileText, MessageSquare, Play, Plus, Search, ShieldCheck, Table2, X } from 'lucide-react'
import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'

type Skill = {
  id: string
  name: string
  description: string
  version: string
  skill_md: string
  skill_type: 'assistant' | 'tabular'
  execution_mode: 'chat' | 'run'
  practice: string | null
  jurisdictions: string[]
  is_system: boolean
  is_active: boolean
  is_owner?: boolean
  is_shared?: boolean
  allow_edit?: boolean
}

const starterSkill = `---
name: matter-next-steps
description: Draft a concise list of attorney-reviewed next steps for a matter
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

export default function WorksClient() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [scope, setScope] = useState('all')
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Skill | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorValue, setEditorValue] = useState(starterSkill)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [runMatterId, setRunMatterId] = useState('')
  const [runLoading, setRunLoading] = useState(false)
  const [runOutput, setRunOutput] = useState<{ id: string; output_text?: string | null; status: string } | null>(null)

  async function loadSkills() {
    setLoading(true)
    const params = new URLSearchParams({ scope, q: query })
    if (type) params.set('type', type)
    const response = await fetch(`/api/admin/works?${params.toString()}`, { cache: 'no-store' })
    const body = await response.json().catch(() => ({})) as { skills?: Skill[]; error?: string }
    if (response.ok) setSkills(body.skills ?? [])
    else setMessage(body.error ?? 'Unable to load Works')
    setLoading(false)
  }

  useEffect(() => { void loadSkills() }, [scope, type]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter(skill => !q || `${skill.name} ${skill.description} ${skill.practice ?? ''}`.toLowerCase().includes(q))
  }, [query, skills])

  async function saveSkill() {
    setSaving(true)
    setMessage(null)
    const response = await fetch(selected ? `/api/admin/works/${selected.id}` : '/api/admin/works', {
      method: selected ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillMd: editorValue }),
    })
    const body = await response.json().catch(() => ({})) as { skill?: Skill; error?: string }
    if (!response.ok) setMessage(body.error ?? 'Unable to save skill')
    else { setEditorOpen(false); setSelected(body.skill ?? null); setMessage('Skill saved'); await loadSkills() }
    setSaving(false)
  }

  async function toggleActive(skill: Skill) {
    if (skill.is_system) return
    const response = await fetch(`/api/admin/works/${skill.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !skill.is_active }) })
    if (response.ok) await loadSkills()
    else setMessage('Unable to update skill activation')
  }

  function launchChat(skill: Skill) {
    openCornerstoneAssistant({ send: true, prompt: `Use this attorney-approved skill. Follow it exactly and return a draft for review.\n\n${skill.skill_md}` })
    setMessage('Skill sent to the admin assistant')
  }

  async function copySkill(skill: Skill) {
    await navigator.clipboard.writeText(skill.skill_md)
    setMessage('SKILL.md copied to clipboard')
  }

  async function shareSkill(skill: Skill) {
    const email = window.prompt('Share this skill with attorney email:')?.trim()
    if (!email) return
    const response = await fetch(`/api/admin/works/${skill.id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    const body = await response.json().catch(() => ({})) as { error?: string }
    setMessage(response.ok ? `Skill shared with ${email}` : body.error ?? 'Unable to share skill')
  }

  async function launchRun() {
    if (!selected) return
    setRunLoading(true)
    const response = await fetch('/api/admin/works/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillId: selected.id, matterId: runMatterId.trim() || null }) })
    const body = await response.json().catch(() => ({})) as { run?: { id: string; output_text?: string | null; status: string }; error?: string }
    if (!response.ok) setMessage(body.error ?? 'Unable to run skill')
    else if (body.run) setRunOutput(body.run)
    setRunLoading(false)
  }

  async function confirmRun() {
    if (!runOutput) return
    const response = await fetch(`/api/admin/works/runs/${runOutput.id}/confirm`, { method: 'POST' })
    if (response.ok) setRunOutput(prev => prev ? { ...prev, status: 'confirmed' } : prev)
    else setMessage('Unable to confirm run')
  }

  async function cancelRun() {
    if (!runOutput) return
    const response = await fetch(`/api/admin/works/runs/${runOutput.id}/cancel`, { method: 'POST' })
    if (response.ok) setRunOutput(prev => prev ? { ...prev, status: 'cancelled' } : prev)
    else setMessage('Unable to cancel run')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground"><BookOpen className="h-5 w-5" /><span className="text-xs font-medium uppercase tracking-wide">Attorney tools</span></div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Works</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Reusable legal skills for review, analysis, and structured matter work.</p>
        </div>
        <button type="button" onClick={() => { setSelected(null); setEditorValue(starterSkill); setEditorOpen(true) }} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" /> New skill</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        {(['all', 'mine', 'shared', 'system', 'inactive'] as const).map(item => <button key={item} type="button" onClick={() => setScope(item)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === item ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{item === 'all' ? 'All active' : item[0].toUpperCase() + item.slice(1)}</button>)}
        <select value={type} onChange={event => setType(event.target.value)} className="ml-auto rounded-md border border-border bg-background px-2 py-1.5 text-xs"><option value="">All types</option><option value="assistant">Assistant</option><option value="tabular">Tabular</option></select>
        <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground"><Search className="h-3.5 w-3.5" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search skills" className="w-40 bg-transparent outline-none" /></label>
      </div>

      {message && <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{message}</div>}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {loading ? <p className="p-8 text-sm text-muted-foreground">Loading skills…</p> : filtered.length === 0 ? <div className="p-10 text-center"><BookOpen className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No skills in this view</p><p className="mt-1 text-xs text-muted-foreground">Create a skill or change the scope filter.</p></div> : <div className="divide-y divide-border">{filtered.map(skill => <button key={skill.id} type="button" onClick={() => setSelected(skill)} className={`flex w-full items-start gap-3 p-4 text-left hover:bg-muted/50 ${selected?.id === skill.id ? 'bg-muted/60' : ''}`}><span className="mt-0.5 rounded-md bg-accent/20 p-2">{skill.skill_type === 'tabular' ? <Table2 className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{skill.name}</span>{skill.is_system && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">System</span>}{skill.is_shared && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">Shared</span>}{!skill.is_active && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">Inactive</span>}</span><span className="mt-1 block text-sm text-muted-foreground">{skill.description}</span><span className="mt-2 block text-xs text-muted-foreground">{skill.practice ?? 'General'} · {skill.execution_mode} · v{skill.version}</span></span></button>)}</div>}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          {!selected ? <div className="flex min-h-64 flex-col items-center justify-center text-center text-muted-foreground"><FileText className="h-8 w-8" /><p className="mt-3 text-sm">Select a skill to preview it</p></div> : <><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-muted-foreground">{selected.description}</p></div><span className="rounded-full border border-border px-2 py-1 text-[10px]">{selected.skill_type}</span></div><div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{selected.practice ?? 'General'}</span>{selected.jurisdictions.map(jurisdiction => <span key={jurisdiction}>· {jurisdiction}</span>)}</div><pre className="mt-4 max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs leading-5">{selected.skill_md}</pre><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void copySkill(selected)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium"><Copy className="h-3.5 w-3.5" /> Export</button><button type="button" disabled={!selected.is_active} onClick={() => launchChat(selected)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-50"><MessageSquare className="h-3.5 w-3.5" /> Use in chat</button>{selected.execution_mode === 'run' && <button type="button" disabled={!selected.is_active} onClick={() => setRunOutput(null)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Play className="h-3.5 w-3.5" /> Dedicated run</button>}{selected.is_owner && !selected.is_system && <><button type="button" onClick={() => { setEditorValue(selected.skill_md); setEditorOpen(true) }} className="rounded-md border border-border px-3 py-2 text-xs font-medium">Edit</button><button type="button" onClick={() => void shareSkill(selected)} className="rounded-md border border-border px-3 py-2 text-xs font-medium">Share</button><button type="button" onClick={() => void toggleActive(selected)} className="rounded-md border border-border px-3 py-2 text-xs font-medium">{selected.is_active ? 'Deactivate' : 'Activate'}</button></>}</div>{runOutput === null && selected.execution_mode === 'run' && <div className="mt-4 rounded-md border border-border p-3"><label className="text-xs font-medium">Matter ID (optional)<input value={runMatterId} onChange={event => setRunMatterId(event.target.value)} placeholder="Paste matter ID for approved context" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" /></label><button type="button" onClick={() => void launchRun()} disabled={runLoading} className="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">{runLoading ? 'Running…' : 'Run skill'}</button></div>}{runOutput && <div className="mt-4 rounded-md border border-border p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">Run {runOutput.status}</span>{runOutput.status === 'awaiting_confirmation' && <ShieldCheck className="h-4 w-4 text-amber-600" />}</div><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5">{runOutput.output_text ?? 'No output'}</pre>{runOutput.status === 'awaiting_confirmation' && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void confirmRun()} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"><Check className="h-3.5 w-3.5" /> Confirm review</button><button type="button" onClick={() => void cancelRun()} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-medium"><X className="h-3.5 w-3.5" /> Cancel</button></div>}</div>}</>}
        </div>
      </div>

      {editorOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card p-5 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">{selected ? 'Edit skill' : 'New skill'}</h2><p className="text-xs text-muted-foreground">SKILL.md is the portable source of truth.</p></div><button type="button" onClick={() => setEditorOpen(false)}><X className="h-5 w-5" /></button></div><textarea value={editorValue} onChange={event => setEditorValue(event.target.value)} className="mt-4 min-h-[420px] flex-1 rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 outline-none" spellCheck={false} /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setEditorOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={() => void saveSkill()} disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{saving ? 'Saving…' : 'Save skill'}</button></div></div></div>}
    </div>
  )
}
