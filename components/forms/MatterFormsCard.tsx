'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ClipboardList, Copy, Download, Mail, MoreHorizontal, Plus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { intakeTrackLabel, type IntakeTrack } from '@/lib/intakeTrack'
import { clientFormQuestions, formatClientFormAnswer, type ClientFormAnswers } from '@/lib/forms/clientFormAnswers'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import type { MatterFormsOverview, MatterIntakeSummary, MatterFormAssignmentSummary } from '@/lib/forms/matterForms'

const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' })

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const json = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(json.error || 'Request failed')
  return json
}

function intakeStatus(intake: MatterIntakeSummary): string {
  if (intake.status === 'submitted' || intake.status === 'approved') return 'Submitted'
  if (intake.sentAt) return 'Sent'
  return intake.status === 'draft' ? 'Not sent' : 'In progress'
}
const assignmentStatus: Record<MatterFormAssignmentSummary['status'], string> = {
  sent: 'Sent', in_progress: 'In progress', submitted: 'Submitted', cancelled: 'Withdrawn',
}

/**
 * Everything this matter asks its clients to fill in: the primary intake, any
 * linked questionnaires (a student's College Prep beside the parents' estate
 * plan), and client forms built in Settings → Intake forms.
 *
 * The primary intake keeps its own controls elsewhere on the page; this card
 * only lists it so the full set is visible in one place.
 */
export function MatterFormsCard({ matterId }: { matterId: string }) {
  const [overview, setOverview] = useState<MatterFormsOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(false)
  const [viewing, setViewing] = useState<MatterFormAssignmentSummary | null>(null)

  const load = useCallback(async () => {
    try {
      setOverview(await call<MatterFormsOverview>(`/api/admin/matters/${matterId}/forms`))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load forms')
    }
  }, [matterId])
  useEffect(() => { void load() }, [load])

  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true)
    try { await run(); toast.success(success); await load() }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Something went wrong') }
    finally { setBusy(false) }
  }

  async function copyLink(intake: MatterIntakeSummary) {
    await act(async () => {
      const { url } = await call<{ url: string | null }>(`/api/admin/intake/link?intakeId=${encodeURIComponent(intake.id)}`)
      if (!url) throw new Error('This link was revoked. Email a new invitation to issue one.')
      await navigator.clipboard.writeText(url)
    }, 'Link copied')
  }

  const linked = overview?.intakes.filter(intake => !intake.primary) ?? []
  const assignments = overview?.assignments.filter(row => row.status !== 'cancelled') ?? []

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Forms">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="font-semibold">Forms</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Questionnaires and forms for everyone on this matter.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!overview || busy} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Add questionnaire</Button>
          <Button type="button" size="sm" disabled={!overview || busy} onClick={() => setSending(true)}><Send className="h-3.5 w-3.5" />Send form</Button>
        </div>
      </div>

      {loadError && <p role="alert" className="mt-3 text-sm text-destructive">{loadError} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>}
      {!overview && !loadError && <p className="mt-3 text-sm text-muted-foreground">Loading forms…</p>}

      {overview && <div className="mt-3 space-y-4">
        <ul className="divide-y divide-border rounded-md border border-border">
          {overview.intakes.map(intake => (
            <li key={intake.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {intakeTrackLabel(intake.track)} questionnaire
                  {intake.primary ? <Badge variant="secondary" className="ml-2">Primary</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">{[intake.label, intake.name, intakeStatus(intake)].filter(Boolean).join(' · ')}</p>
              </div>
              {!intake.primary && (
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" disabled={busy || !intake.email} onClick={() => void act(
                    () => call('/api/admin/intake/send', 'POST', { matterId, intakeId: intake.id }), `Questionnaire emailed to ${intake.email}`,
                  )}><Mail className="h-3.5 w-3.5" />Email link</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" aria-label={`More actions for ${intake.name}`} disabled={busy}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void copyLink(intake)}><Copy className="h-3.5 w-3.5" />Copy link</DropdownMenuItem>
                      <DropdownMenuItem asChild><a href={`/api/admin/intake/${intake.id}/export`} download><Download className="h-3.5 w-3.5" />Download answers (Word)</a></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => {
                        if (!window.confirm(`Remove ${intake.name}'s questionnaire from this matter? Any answers already given are kept.`)) return
                        void act(() => call(`/api/admin/matters/${matterId}/linked-intakes/${intake.linkId}`, 'DELETE'), 'Questionnaire removed')
                      }}>Remove from matter</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </li>
          ))}
          {assignments.map(row => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{row.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[row.recipientName, assignmentStatus[row.status], row.submittedAt ? `submitted ${dateFormat.format(new Date(row.submittedAt))}` : `sent ${dateFormat.format(new Date(row.sentAt))}`].join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setViewing(row)}>{row.status === 'submitted' ? 'View answers' : 'View'}</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" aria-label={`More actions for ${row.title}`} disabled={busy}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {row.status === 'submitted' ? (
                      <DropdownMenuItem onSelect={() => void act(() => call(`/api/admin/matters/${matterId}/forms/${row.id}`, 'PATCH', { action: 'reopen' }), 'Form reopened for the client')}>Reopen for changes</DropdownMenuItem>
                    ) : <>
                      <DropdownMenuItem onSelect={() => void act(() => call(`/api/admin/matters/${matterId}/forms/${row.id}`, 'PATCH', { action: 'resend' }), 'Form emailed again')}>Resend email</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => {
                        if (!window.confirm(`Withdraw "${row.title}"? The client will no longer see it.`)) return
                        void act(() => call(`/api/admin/matters/${matterId}/forms/${row.id}`, 'PATCH', { action: 'cancel' }), 'Form withdrawn')
                      }}>Withdraw</DropdownMenuItem>
                    </>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
        {linked.length === 0 && assignments.length === 0 && (
          <p className="text-xs text-muted-foreground">Add a questionnaire for someone else on this matter — a student&apos;s College Prep, say — or send a form you built in <Link href="/admin/settings/intake-forms" className="underline">Intake forms</Link>.</p>
        )}
      </div>}

      {overview && <AddQuestionnaireDialog open={adding} onOpenChange={setAdding} onAdd={async input => {
        await act(() => call(`/api/admin/matters/${matterId}/linked-intakes`, 'POST', input), 'Questionnaire added')
        setAdding(false)
      }} busy={busy} />}
      {overview && <SendFormDialog open={sending} onOpenChange={setSending} overview={overview} busy={busy} onSend={async input => {
        await act(() => call(`/api/admin/matters/${matterId}/forms`, 'POST', input), 'Form sent')
        setSending(false)
      }} />}
      <AnswersDialog matterId={matterId} assignment={viewing} onClose={() => setViewing(null)} />
    </section>
  )
}

function AddQuestionnaireDialog({ open, onOpenChange, onAdd, busy }: {
  open: boolean; onOpenChange: (open: boolean) => void; busy: boolean
  onAdd: (input: { firstName: string; lastName: string; email: string; track: IntakeTrack; label: string | null }) => Promise<void>
}) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', track: 'college_prep' as IntakeTrack, label: 'Student' })
  const valid = form.firstName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add a questionnaire</DialogTitle>
        <DialogDescription>For another person on this matter. They get their own questionnaire, link and portal access. Use the email of whoever will fill it in — a parent can complete a student&apos;s College Prep.</DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (valid) void onAdd({ ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), label: form.label.trim() || null }) }}>
        <div className="space-y-1"><Label htmlFor="linked-track">Questionnaire</Label>
          <select id="linked-track" className={selectClass} value={form.track} onChange={event => setForm({ ...form, track: event.target.value as IntakeTrack })}>
            <option value="college_prep">College Preparation Plan</option>
            <option value="estate">Estate Planning</option>
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="linked-first">{form.track === 'college_prep' ? "Student's first name" : 'First name'}</Label><Input id="linked-first" value={form.firstName} maxLength={100} onChange={event => setForm({ ...form, firstName: event.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="linked-last">Last name</Label><Input id="linked-last" value={form.lastName} maxLength={100} onChange={event => setForm({ ...form, lastName: event.target.value })} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="linked-email">Email for the link</Label><Input id="linked-email" type="email" value={form.email} maxLength={320} onChange={event => setForm({ ...form, email: event.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="linked-label">Role on the matter (optional)</Label><Input id="linked-label" value={form.label} maxLength={160} placeholder="Student" onChange={event => setForm({ ...form, label: event.target.value })} /></div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={busy || !valid}>{busy ? 'Adding…' : 'Add questionnaire'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function SendFormDialog({ open, onOpenChange, overview, onSend, busy }: {
  open: boolean; onOpenChange: (open: boolean) => void; overview: MatterFormsOverview; busy: boolean
  onSend: (input: { templateId: string; recipientIntakeId: string }) => Promise<void>
}) {
  const [templateId, setTemplateId] = useState('')
  const [recipientIntakeId, setRecipient] = useState('')
  const template = templateId || overview.options[0]?.templateId || ''
  const recipient = recipientIntakeId || overview.intakes[0]?.id || ''
  const chosen = overview.options.find(option => option.templateId === template)
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Send a form</DialogTitle>
        <DialogDescription>Emails a link to a form you built in Intake forms. Answers are kept with the form on this matter.</DialogDescription>
      </DialogHeader>
      {overview.options.length === 0 ? (
        <p className="text-sm">No client forms are published yet. Create one in <Link href="/admin/settings/intake-forms" className="underline">Settings → Intake forms</Link> with the purpose “Client form”, add your questions, and publish it.</p>
      ) : (
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (template && recipient) void onSend({ templateId: template, recipientIntakeId: recipient }) }}>
          <div className="space-y-1"><Label htmlFor="send-form-template">Form</Label>
            <select id="send-form-template" className={selectClass} value={template} onChange={event => setTemplateId(event.target.value)}>
              {overview.options.map(option => <option key={option.templateId} value={option.templateId}>{option.name} (v{option.version})</option>)}
            </select>
            {chosen?.description && <p className="text-xs text-muted-foreground">{chosen.description}</p>}
          </div>
          <div className="space-y-1"><Label htmlFor="send-form-recipient">Send to</Label>
            <select id="send-form-recipient" className={selectClass} value={recipient} onChange={event => setRecipient(event.target.value)}>
              {overview.intakes.map(intake => <option key={intake.id} value={intake.id} disabled={!intake.email}>{intake.name}{intake.email ? ` — ${intake.email}` : ' (no email on file)'}</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !template || !recipient}>{busy ? 'Sending…' : 'Send form'}</Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  </Dialog>
}

function AnswersDialog({ matterId, assignment, onClose }: { matterId: string; assignment: MatterFormAssignmentSummary | null; onClose: () => void }) {
  const [detail, setDetail] = useState<{ form: CompiledIntakeForm; assignment: { answers: ClientFormAnswers } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDetail(null); setError(null)
    if (!assignment) return
    let cancelled = false
    call<{ form: CompiledIntakeForm; assignment: { answers: ClientFormAnswers } }>(`/api/admin/matters/${matterId}/forms/${assignment.id}`)
      .then(result => { if (!cancelled) setDetail(result) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load answers') })
    return () => { cancelled = true }
  }, [matterId, assignment])
  return <Dialog open={Boolean(assignment)} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{assignment?.title}</DialogTitle>
        <DialogDescription>{assignment ? `${assignment.recipientName} · ${assignmentStatus[assignment.status]}` : null}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!detail && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {detail && <div className="space-y-4">
        {detail.form.sections.map(section => {
          const questions = clientFormQuestions({ ...detail.form, sections: [section] })
          return <div key={section.id} className="space-y-2">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <dl className="space-y-2">
              {questions.map(question => <div key={question.id}>
                <dt className="text-xs text-muted-foreground">{question.label}</dt>
                <dd className="whitespace-pre-wrap text-sm">{formatClientFormAnswer(question, detail.assignment.answers[question.id])}</dd>
              </div>)}
            </dl>
          </div>
        })}
      </div>}
    </DialogContent>
  </Dialog>
}
