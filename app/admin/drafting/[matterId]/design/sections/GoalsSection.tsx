'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { SectionBlock, type SectionProps } from './shared'

export function GoalsSection({ sheet, onChange }: SectionProps) {
  const [concerns, setConcerns] = useState(sheet.concerns ?? '')
  const [goals, setGoals] = useState(sheet.goals_notes ?? '')
  const [draftingNotes, setDraftingNotes] = useState(sheet.drafting_notes ?? '')

  return (
    <div>
      <SectionBlock
        title="Client Goals"
        subtitle="What the client wants to achieve with their estate plan"
      >
        <Textarea
          value={goals}
          onChange={e => setGoals(e.target.value)}
          onBlur={() => onChange('goals_notes', goals || null)}
          placeholder="What outcomes does the client want to achieve with this estate plan?"
          className="min-h-[120px] resize-y text-sm leading-relaxed bg-muted border-border"
          maxLength={2000}
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">Saved automatically on blur.</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">{goals.length} / 2000</p>
        </div>
      </SectionBlock>

      <SectionBlock
        title="Client Concerns"
        subtitle="Concerns, worries, or special circumstances raised by the client"
      >
        <Textarea
          value={concerns}
          onChange={e => setConcerns(e.target.value)}
          onBlur={() => onChange('concerns', concerns || null)}
          placeholder="What are the client's primary concerns? (e.g., avoiding probate, protecting assets, providing for minors)"
          className="min-h-[120px] resize-y text-sm leading-relaxed bg-muted border-border"
          maxLength={2000}
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">Saved automatically on blur.</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">{concerns.length} / 2000</p>
        </div>
      </SectionBlock>

      <SectionBlock
        title="Attorney Notes"
        subtitle="Internal notes — not shared with client"
      >
        <Textarea
          value={draftingNotes}
          onChange={e => setDraftingNotes(e.target.value)}
          onBlur={() => onChange('drafting_notes', draftingNotes || null)}
          placeholder="Attorney notes about this matter…"
          rows={5}
          className="resize-none text-sm leading-relaxed bg-card border-border"
        />
      </SectionBlock>
    </div>
  )
}
