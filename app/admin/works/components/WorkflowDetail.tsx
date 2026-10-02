'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, Download, FileText, MessageSquare, Play, ShieldCheck, X } from 'lucide-react'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { skillBody, skillColumns, type WorkSkill } from '@/components/works/types'
import { renameSkillMarkdown } from '@/lib/works/skill'

interface RunState {
  id: string
  output_text?: string | null
  status: string
}

interface RunArtifact {
  id: string
  filename: string
  size: number
  status: string
  downloadUrl: string
}

interface PreflightIssue { field: string; message: string }

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
  const [runArtifacts, setRunArtifacts] = useState<RunArtifact[]>([])
  const [preflight, setPreflight] = useState<PreflightIssue[]>([])
  const [pmpsHasLegalPlan, setPmpsHasLegalPlan] = useState('')
  const [pmpsLegalPlanName, setPmpsLegalPlanName] = useState('')
  const [pmpsFlatFee, setPmpsFlatFee] = useState('')
  const [pmpsPlanStructure, setPmpsPlanStructure] = useState('')
  const [metlifePlanType, setMetlifePlanType] = useState('')
  const [metlifeMemberId, setMetlifeMemberId] = useState('')
  const [metlifeServiceStart, setMetlifeServiceStart] = useState('')
  const [metlifeServiceEnd, setMetlifeServiceEnd] = useState('')
  const [metlifeRealtyCount, setMetlifeRealtyCount] = useState('')
  const [metlifeMinorGuardian, setMetlifeMinorGuardian] = useState('')

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
      body: JSON.stringify({ skillMd: renameSkillMarkdown(skill.skill_md, `Copy of ${skill.name}`) }),
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
      // Send the version this view was built from: the server refuses a write
      // that would silently overwrite someone else's edit.
      body: JSON.stringify({ isActive: !skill.is_active, expectedUpdatedAt: skill.updated_at }),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (response.ok) {
      await onChanged()
    } else if (response.status === 409) {
      toast.error(body.error ?? 'This skill changed elsewhere. Reloading.')
      await onChanged()
    } else {
      toast.error(body.error ?? 'Unable to update skill activation')
    }
  }

  async function launchRun() {
    if (!skill) return
    setRunLoading(true)
    const response = await fetch('/api/admin/works/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId: skill.id,
        matterId: runMatterId.trim() || null,
        ...(skill.slug === 'prepare-pmps-package' ? { input: {
          ...(pmpsHasLegalPlan ? { hasLegalPlan: pmpsHasLegalPlan === 'yes' } : {}),
          ...(pmpsLegalPlanName.trim() ? { legalPlanName: pmpsLegalPlanName.trim() } : {}),
          ...(pmpsFlatFee ? { flatFee: Number(pmpsFlatFee) } : {}),
          ...(pmpsPlanStructure ? { planStructure: pmpsPlanStructure } : {}),
        } } : {}),
        ...(skill.slug === 'prepare-metlife-claim' ? { input: {
          ...(metlifePlanType ? { planType: metlifePlanType } : {}),
          ...(metlifeMemberId.trim() ? { memberId: metlifeMemberId.trim() } : {}),
          ...(metlifeServiceStart ? { serviceStart: metlifeServiceStart } : {}),
          ...(metlifeServiceEnd ? { serviceEnd: metlifeServiceEnd } : {}),
          ...(metlifeRealtyCount ? { realtyTrustCount: Number(metlifeRealtyCount) } : {}),
          ...(metlifeMinorGuardian ? { includeMinorGuardian: metlifeMinorGuardian === 'yes' } : {}),
        } } : {}),
      }),
    })
    const body = await response.json().catch(() => ({})) as { run?: RunState; artifacts?: RunArtifact[]; preflight?: PreflightIssue[]; error?: string }
    setPreflight(body.preflight ?? [])
    setRunArtifacts(body.artifacts ?? [])
    if (!response.ok) {
      if (body.run) setRunOutput(body.run)
      toast.error(body.error ?? 'Unable to run skill')
    } else if (body.run) setRunOutput(body.run)
    setRunLoading(false)
  }

  /** Re-read the run rather than assuming the result: confirmation has several
   *  side effects and a partial failure used to still paint "confirmed". */
  async function reloadRun(runId: string) {
    const response = await fetch(`/api/admin/works/runs/${runId}`, { cache: 'no-store' })
    const body = await response.json().catch(() => ({})) as { run?: RunState; artifacts?: RunArtifact[] }
    if (response.ok && body.run) {
      setRunOutput(body.run)
      setRunArtifacts(body.artifacts ?? [])
    }
  }

  async function confirmRun() {
    if (!runOutput) return
    const runId = runOutput.id
    const response = await fetch(`/api/admin/works/runs/${runId}/confirm`, { method: 'POST' })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) toast.error(body.error ?? 'Unable to confirm run')
    await reloadRun(runId)
  }

  async function cancelRun() {
    if (!runOutput) return
    const runId = runOutput.id
    const response = await fetch(`/api/admin/works/runs/${runId}/cancel`, { method: 'POST' })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) toast.error(body.error ?? 'Unable to cancel run')
    await reloadRun(runId)
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

      <div className="mt-4 max-h-80 overflow-y-auto rounded-md border border-border bg-muted p-4 text-sm">
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
                <TableHead className="w-20">Format</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map(column => (
                <TableRow key={column.index}>
                  {/* Table cells default to nowrap; the name and prompt are prose and must wrap. */}
                  <TableCell className="align-top text-muted-foreground">{column.index}</TableCell>
                  <TableCell className="whitespace-normal align-top font-medium">{column.name}</TableCell>
                  <TableCell className="min-w-32 whitespace-normal break-words align-top text-xs leading-5 text-muted-foreground">{column.prompt}</TableCell>
                  <TableCell className="whitespace-normal align-top text-xs">{(column.format ?? 'text').replaceAll('_', ' ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {skill.skill_type === 'assistant' && skill.execution_mode === 'chat' && (
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
          {skill.slug === 'prepare-pmps-package' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium">Legal plan
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={pmpsHasLegalPlan} onChange={event => setPmpsHasLegalPlan(event.target.value)}>
                  <option value="">Use approved matter value</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </label>
              <label className="text-xs font-medium">Legal-plan name (if applicable)
                <Input className="mt-1" value={pmpsLegalPlanName} onChange={event => setPmpsLegalPlanName(event.target.value)} placeholder="MetLife, ARAG…" />
              </label>
              <label className="text-xs font-medium">Approved flat fee (if no plan)
                <Input className="mt-1" type="number" min="0" step="1" value={pmpsFlatFee} onChange={event => setPmpsFlatFee(event.target.value)} placeholder="3500" />
              </label>
              <label className="text-xs font-medium">Approved plan structure
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={pmpsPlanStructure} onChange={event => setPmpsPlanStructure(event.target.value)}>
                  <option value="">Select…</option>
                  <option value="joint_outright">Joint — outright</option>
                  <option value="joint_disclaimer">Joint — disclaimer</option>
                  <option value="separate_clayton">Separate — Clayton</option>
                  <option value="individual_single">Individual</option>
                </select>
              </label>
            </div>
          )}
          {skill.slug === 'prepare-metlife-claim' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium">Plan composition
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metlifePlanType} onChange={event => setMetlifePlanType(event.target.value)}>
                  <option value="">Derive from the design sheet</option>
                  <option value="joint_trust">Couple Joint Trust</option>
                  <option value="separate_trust">Couple Separate Trusts</option>
                  <option value="will_couple">Couple Will</option>
                  <option value="individual_trust">Individual Trust</option>
                  <option value="will_individual">Individual Will</option>
                </select>
              </label>
              <label className="text-xs font-medium">Member ID
                <Input className="mt-1" value={metlifeMemberId} onChange={event => setMetlifeMemberId(event.target.value)} placeholder="Use the approved matter value" />
              </label>
              <label className="text-xs font-medium">Work started
                <Input className="mt-1" type="date" value={metlifeServiceStart} onChange={event => setMetlifeServiceStart(event.target.value)} />
              </label>
              <label className="text-xs font-medium">Work finished
                <Input className="mt-1" type="date" value={metlifeServiceEnd} onChange={event => setMetlifeServiceEnd(event.target.value)} />
              </label>
              <label className="text-xs font-medium">Realty trust properties
                <Input className="mt-1" type="number" min="0" step="1" value={metlifeRealtyCount} onChange={event => setMetlifeRealtyCount(event.target.value)} placeholder="Derive from the design sheet" />
              </label>
              <label className="text-xs font-medium">Temporary guardian affidavit
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metlifeMinorGuardian} onChange={event => setMetlifeMinorGuardian(event.target.value)}>
                  <option value="">Derive from the design sheet</option>
                  <option value="yes">Include</option>
                  <option value="no">Omit</option>
                </select>
              </label>
            </div>
          )}
          <Button type="button" size="sm" className="mt-3" disabled={runLoading} onClick={() => void launchRun()}>
            {runLoading ? 'Running…' : 'Run skill'}
          </Button>
        </div>
      )}

      {runOutput && (
        <div className="mt-4 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Run {runOutput.status}</span>
            {runOutput.status === 'awaiting_confirmation' && <ShieldCheck className="h-4 w-4 text-amber" />}
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-5">{runOutput.output_text ?? 'No output'}</pre>
          {preflight.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-border bg-amber-bg p-3 text-xs text-amber">
              <p className="font-semibold">Required before generation</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">{preflight.map(issue => <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>)}</ul>
            </div>
          )}
          {runArtifacts.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">Generated drafts</p>
                <div className="flex gap-2">
                  {skill.slug === 'prepare-metlife-claim' && (
                    <Button asChild type="button" size="sm" variant="outline">
                      <a href={`/api/admin/works/runs/${runOutput.id}/submission?format=csv`}><Download className="h-3.5 w-3.5" /> Submission table</a>
                    </Button>
                  )}
                  <Button asChild type="button" size="sm" variant="outline"><a href={`/api/admin/works/runs/${runOutput.id}/artifacts`}><Download className="h-3.5 w-3.5" /> Download ZIP</a></Button>
                </div>
              </div>
              {runArtifacts.map(artifact => <div key={artifact.id} className="flex items-center justify-between rounded border p-2 text-xs"><span>{artifact.filename} · {(artifact.size / 1024).toFixed(1)} KB</span><Button asChild type="button" size="sm" variant="ghost"><a href={artifact.downloadUrl}><Download className="h-3.5 w-3.5" /> Download</a></Button></div>)}
            </div>
          )}
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
          {runOutput.status === 'failed' && preflight.length > 0 && (
            <Button type="button" size="sm" className="mt-3" onClick={() => setRunOutput(null)}>Edit inputs and retry</Button>
          )}
        </div>
      )}
    </div>
  )
}
