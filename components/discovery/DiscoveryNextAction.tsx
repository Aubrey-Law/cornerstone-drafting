'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { TaskComposer } from '@/components/tasks/TaskComposer'
import { useTaskActions } from '@/components/tasks/useTaskActions'
import { BookingPageDialog } from '@/components/scheduling/BookingPageDialog'
import type { DiscoveryCall } from '@/lib/discovery/contracts'
import { getFormField } from '@/lib/discovery/catalog'

const deliverySchema = z.object({ email: z.enum(['sent', 'suppressed', 'redirected', 'logged', 'error']) })
const deliveryMessages = {
  sent: 'Organizer email sent.',
  suppressed: 'No email sent. Organizer delivery is suppressed; review email settings before retrying.',
  redirected: 'Organizer email went to the test inbox, not the client. Review email settings before retrying.',
  logged: 'No email sent. Delivery was only logged; configure email delivery before retrying.',
  error: 'Organizer email could not be sent. You can retry.',
}

export function DiscoveryNextAction({ call, name, email }: { call: DiscoveryCall; name: string; email: string }) {
  const [booking, setBooking] = useState(false)
  const [task, setTask] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [notice, setNotice] = useState('')
  const [taskResult, setTaskResult] = useState<{ id: string; reused: boolean } | null>(null)
  const actions = useTaskActions()
  const action = String(call.answers.discovery_next_action ?? '')
  const title = getFormField('discovery_next_action').options?.find(o => o.value === action)?.label ?? action
  const callUrl = `/admin/crm/opportunities/${call.lead_id}/discovery/${call.id}`

  async function send() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/intake/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intakeId: call.lead_id }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Could not send organizer')
      const delivery = deliverySchema.parse(result).email
      setNotice(deliveryMessages[delivery])
      setSent(delivery === 'sent')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send organizer')
    } finally {
      setBusy(false)
    }
  }

  return <section className="space-y-3 rounded-lg border bg-card p-4">
    <h2 className="font-semibold">Next action</h2>
    <p>{title}</p>
    <p className="whitespace-pre-wrap text-sm">{String(call.answers.discovery_action_reason ?? '')}</p>
    {notice && <p role="status">{notice}</p>}
    {taskResult ? <p role="status">
      {taskResult.reused ? 'An equivalent open task already exists. ' : 'Follow-up task created. '}
      <Link className="underline" href={`/admin/tasks?focus=${taskResult.id}`}>Open task</Link>
    </p> : action === 'no_further_action' ? null : action === 'send_organizer' ? (
      !sent && <Button onClick={() => void send()} disabled={busy || !email}>{busy ? 'Sending…' : 'Send organizer'}</Button>
    ) : action === 'schedule_meeting' ? <Button onClick={() => setBooking(true)}>Schedule meeting</Button> : (
      <Button onClick={() => setTask(true)}>Prepare follow-up task</Button>
    )}
    {action === 'send_organizer' && !email && <p className="text-sm">Add a lead email address before sending the organizer.</p>}
    {task && !taskResult && <>
      <p className="text-sm text-muted-foreground">Choose an owner and include a due date in the task title, such as “Friday 2pm”. Existing open tasks are checked before creation.</p>
      <TaskComposer initialTitle={title} defaultRecord={{ id: call.lead_id, kind: 'lead', name, detail: null }} lockRecord onCreate={async input => {
        if (!input.assignee_id || !input.due_at) { toast.error('Choose an owner and a due date.'); return null }
        try {
          const res = await fetch(`/api/admin/tasks?recordId=${call.lead_id}&status=open&scope=all&owner=all`)
          if (!res.ok) throw new Error('Could not check existing tasks. Retry before creating one.')
          const existing = z.object({ tasks: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().nullable().optional() }).passthrough()) }).passthrough().parse(await res.json())
          const match = existing.tasks.find(t => t.description?.includes(callUrl) || t.title.trim().toLowerCase() === input.title.trim().toLowerCase())
          if (match) { setTaskResult({ id: match.id, reused: true }); return null }
          const created = await actions.create({ ...input, description: `Discovery call: ${callUrl}\n${String(call.answers.discovery_action_reason ?? '')}` })
          if (created) setTaskResult({ id: created.id, reused: false })
          return created
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not prepare task'); return null }
      }} />
    </>}
    <BookingPageDialog open={booking} onOpenChange={setBooking} target={{ kind: 'lead', id: call.lead_id }} />
  </section>
}
