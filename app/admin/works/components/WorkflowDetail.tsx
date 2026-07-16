'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, FileText, MessageSquare, Play, ShieldCheck, X } from 'lucide-react'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { skillBody, skillColumns, type WorkSkill } from '@/components/works/types'

interface RunState {
  id: string
  output_text?: string | null
  status: string
}

interface WorkflowDetailProps {
  skill: WorkSkill | null
  onEdit: (skill: WorkSkill) => void
  onShare: (skill: WorkSkill) => void
  onChanged: () => Promise<void> | void
}

export function WorkflowDetail({ skill, onEdit, onShare, onChanged }: WorkflowDetailProps) {
  const router = useRouter()
  const [runMatterId, setRunMatterId] = useState('')
  const [runLoading, setRunLoading] = useState(false)
  const [runOutput, setRunOutput] = useState<RunState | null>(null)
  const [runPanelOpen, setRunPanelOpen] = useState(false)

  if (!skill) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-border bg-card p-5 text-center text-muted-foreground">
        <FileText className="h-8 w-8" />
        <p className="mt-3 text-sm">Select a workflow to preview it</p>
      </div>
    )
  }

  const columns = skill.skill_type === 'tabular' ? skillColumns(skill) : []

  async function copySkill() {
    if (!skill) return
    await navigator.clipboard.writeText(skill.skill_md)
    toast.success('SKILL.md copied to clipboard')
  }

  async function duplicateSkill() {
    if (!skill) return
    const response = await fetch('/api/admin/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillMd: skill.skill_md }),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (response.ok) {
      toast.success('Duplicated as a custom skill you can edit')
      await onChanged()
    } else {
      toast.error(body.error ?? 'Unable to duplicate skill')
    }
  }

  async function toggleActive() {
    if (!skill || skill.is_system) return
    const response = await fetch(`/api/admin/works/${skill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !skill.is_active }),
    })
    if (response.ok) await onChanged()
    else toast.error('Unable to update skill activation')
  }

  async function launchRun() {
    if (!skill) return
    setRunLoading(true)
    const response = await fetch('/api/admin/works/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: skill.id, matterId: runMatterId.trim() || null }),
    })
    const body = await response.json().catch(() => ({})) as { run?: RunState; error?: string }
    if (!response.ok) toast.error(body.error ?? 'Unable to run skill')
    else if (body.run) setRunOutput(body.run)
    setRunLoading(false)
  }

  async function confirmRun() {
    if (!runOutput) return
    const response = await fetch(`/api/admin/works/runs/${runOutput.id}/confirm`, { method: 'POST' })
    if (response.ok) setRunOutput(prev => prev ? { ...prev, status: 'confirmed' } : prev)
    else toast.error('Unable to confirm run')
  }

  async function cancelRun() {
    if (!runOutput) return
    const response = await fetch(`/api/admin/works/runs/${runOutput.id}/cancel`, { method: 'POST' })
    if (response.ok) setRunOutput(prev => prev ? { ...prev, status: 'cancelled' } : prev)
    else toast.error('Unable to cancel run')
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{skill.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
        </div>
        <Badge variant="outline">{skill.skill_type}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{skill.practice ?? 'General'}</span>
        {skill.jurisdictions.map(jurisdiction => <span key={jurisdiction}>· {jurisdiction}</span>)}
        <span>· {skill.execution_mode}</span>
        <span>· v{skill.version}</span>
      </div>

      <div className="mt-4 max-h-80 overflow-y-auto rounded-md border border-border bg-muted/40 p-4 text-sm">
        <ChatMarkdown content={skillBody(skill.skill_md)} />
      </div>

      {columns.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Column</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead className="w-28">Format</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map(column => (
                <TableRow key={column.index}>
                  <TableCell className="text-muted-foreground">{column.index}</TableCell>
                  <TableCell className="font-medium">{column.name}</TableCell>
                  <TableCell className="max-w-md text-xs text-muted-foreground">{column.prompt}</TableCell>
                  <TableCell className="text-xs">{column.format ?? 'text'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {skill.skill_type === 'assistant' && (
          <Button
            type="button"
            size="sm"
            disabled={!skill.is_active}
            onClick={() => router.push(`/admin/assistant?workflow=${skill.id}`)}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Use in assistant
          </Button>
        )}
        {skill.execution_mode === 'run' && (
          <Button type="button" size="sm" variant="secondary" disabled={!skill.is_active} onClick={() => { setRunOutput(null); setRunPanelOpen(true) }}>
            <Play className="h-3.5 w-3.5" /> Dedicated run
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => void copySkill()}>
          <Copy className="h-3.5 w-3.5" /> Export
        </Button>
        {skill.is_system ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void duplicateSkill()}>
            Duplicate as custom
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => onEdit(skill)}>Edit</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onShare(skill)}>Share</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void toggleActive()}>
              {skill.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </>
        )}
      </div>

      {runPanelOpen && runOutput === null && skill.execution_mode === 'run' && (
        <div className="mt-4 rounded-md border border-border p-3">
          <label className="text-xs font-medium">
            Matter ID (optional)
            <Input
              value={runMatterId}
              onChange={event => setRunMatterId(event.target.value)}
              placeholder="Paste matter ID for approved context"
              className="mt-1"
            />
          </label>
          <Button type="button" size="sm" className="mt-3" disabled={runLoading} onClick={() => void launchRun()}>
            {runLoading ? 'Running…' : 'Run skill'}
          </Button>
        </div>
      )}

      {runOutput && (
        <div className="mt-4 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Run {runOutput.status}</span>
            {runOutput.status === 'awaiting_confirmation' && <ShieldCheck className="h-4 w-4 text-amber-600" />}
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5">{runOutput.output_text ?? 'No output'}</pre>
          {runOutput.status === 'awaiting_confirmation' && (
            <div className="mt-3 flex gap-2">
              <Button type="button" size="sm" onClick={() => void confirmRun()}>
                <Check className="h-3.5 w-3.5" /> Confirm review
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void cancelRun()}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
