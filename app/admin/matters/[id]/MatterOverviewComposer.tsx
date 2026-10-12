'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/FilterChip'
import { Textarea } from '@/components/ui/textarea'

const modes = ['Note', 'Portal message'] as const
type Mode = typeof modes[number]

interface Props {
  clientName: string
  noteText: string
  onNoteChange: (text: string) => void
  noteSaving: boolean
  onAddNote: () => Promise<void>
  portalDraft: string
  onPortalChange: (text: string) => void
  onSend: (channel: 'portal', body: string) => Promise<boolean>
}

export function MatterOverviewComposer(props: Props) {
  const [mode, setMode] = useState<Mode>('Note')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const busy = pending || props.noteSaving
  const body = mode === 'Note' ? props.noteText : props.portalDraft
  const label = mode === 'Note' ? 'Internal note' : 'Portal message'
  const action = mode === 'Note' ? 'Add note' : 'Send portal message'
  async function submit() {
    if (submitting.current || busy || !body.trim()) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      if (mode === 'Note') await props.onAddNote()
      else if (await props.onSend('portal', body)) props.onPortalChange('')
      else setError('Message was not sent. Your draft is still here; please retry.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Please retry.')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  const hint = mode === 'Note' ? 'Visible to staff only' : `Secure portal message to ${props.clientName}`
  return (
    <section aria-label="Matter communication composer" className="px-4 py-3.5">
      <Textarea
        aria-label={label}
        rows={2}
        placeholder={`Write ${label.toLowerCase()}…`}
        value={body}
        disabled={busy}
        onChange={event => {
          if (mode === 'Note') props.onNoteChange(event.target.value)
          else props.onPortalChange(event.target.value)
        }}
        className="min-h-16 resize-y border-input"
      />
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <div role="group" aria-label="Compose action" className="flex flex-wrap gap-1.5">
          {modes.map(item => (
            <FilterChip key={item} selected={mode === item} disabled={busy} onClick={() => { setMode(item); setError(null) }}>
              {item}
            </FilterChip>
          ))}
        </div>
        <span className="flex-1" />
        <span className="text-muted-foreground">{hint}</span>
        <Button type="button" size="sm" className="h-7 px-2.5 text-compact" disabled={busy || !body.trim()} onClick={() => void submit()}>
          {busy ? (mode === 'Portal message' ? 'Sending…' : 'Saving…') : action}
        </Button>
      </div>
    </section>
  )
}
