'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { SectionBlock, type SectionProps } from './shared'

export function ConcernsSection({ sheet, onChange }: SectionProps) {
  const [value, setValue] = useState(sheet.concerns ?? '')

  return (
    <div>
      <SectionBlock
        title="Client Concerns"
        subtitle="Concerns, worries, or special circumstances raised by the client"
      >
        <Textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={() => onChange('concerns', value || null)}
          placeholder="e.g. Worried about protecting assets from creditors; wants to ensure daughter with special needs is protected; concerned about estate taxes…"
          rows={8}
          className="resize-none text-sm leading-relaxed bg-muted border-border"
        />
        <p className="mt-2 text-[11px] text-muted-foreground">Saved automatically on blur.</p>
      </SectionBlock>
    </div>
  )
}
