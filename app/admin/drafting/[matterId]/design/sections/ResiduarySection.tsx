'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import { SectionBlock } from './shared'

// ── Props ─────────────────────────────────────────────────────────────────────

interface ResiduarySectionProps {
  lpData: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}

// ── Toggle helper ─────────────────────────────────────────────────────────────

function SegmentToggle<T extends string>({
  options,
  value,
  onChange,
  fieldName,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
  fieldName?: string
}) {
  return (
    <div
      id={fieldName ? designFieldTargetId(fieldName) : undefined}
      tabIndex={fieldName ? -1 : undefined}
      className="flex gap-0.5 rounded-lg bg-muted p-[2px]"
    >
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'flex-1 rounded-md px-3 py-2 text-xs transition-all',
            value === o.key
              ? 'bg-card font-semibold text-primary shadow-sm'
              : 'text-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── ResiduarySection ──────────────────────────────────────────────────────────

export function ResiduarySection({ lpData, onChange }: ResiduarySectionProps) {
  const [spouseSurvives, setSpouseSurvives] = useState(
    (lpData.residuary_spouse_survives as string) ?? 'all_to_spouse'
  )
  const [noSpouse, setNoSpouse] = useState(
    (lpData.residuary_no_spouse as string) ?? 'descendants_per_stirpes'
  )
  const [specificGifts, setSpecificGifts] = useState(
    (lpData.residuary_specific_gifts as string) ?? ''
  )
  const [otherInstructions, setOtherInstructions] = useState(
    (lpData.residuary_other_instructions as string) ?? ''
  )

  return (
    <div>
      <SectionBlock title="If spouse / partner survives">
        <SegmentToggle
          fieldName="residuary_spouse_survives"
          options={[
            { key: 'all_to_spouse', label: 'All to spouse / partner' },
            { key: 'other_spouse', label: 'Other' },
          ]}
          value={spouseSurvives}
          onChange={v => {
            setSpouseSurvives(v)
            onChange({ residuary_spouse_survives: v })
          }}
        />
      </SectionBlock>

      <SectionBlock title="If no spouse / partner survives">
        <SegmentToggle
          fieldName="residuary_no_spouse"
          options={[
            { key: 'descendants_per_stirpes', label: 'To descendants, per stirpes' },
            { key: 'other_no_spouse', label: 'Other' },
          ]}
          value={noSpouse}
          onChange={v => {
            setNoSpouse(v)
            onChange({ residuary_no_spouse: v })
          }}
        />
      </SectionBlock>

      <SectionBlock
        title="Specific gifts"
        subtitle='Optional — e.g. "$5,000 to nephew Robert Jones"'
      >
        <Input
          value={specificGifts}
          onChange={e => setSpecificGifts(e.target.value)}
          onBlur={() => onChange({ residuary_specific_gifts: specificGifts })}
          placeholder='e.g. "$5,000 to nephew Robert Jones"'
        />
      </SectionBlock>

      <SectionBlock
        title="Other instructions"
        subtitle="Optional — any additional instructions"
      >
        <Input
          value={otherInstructions}
          onChange={e => setOtherInstructions(e.target.value)}
          onBlur={() => onChange({ residuary_other_instructions: otherInstructions })}
          placeholder="Any additional instructions"
        />
      </SectionBlock>
    </div>
  )
}
