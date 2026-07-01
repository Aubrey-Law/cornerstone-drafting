'use client'

import { Check } from 'lucide-react'

export interface PlanStructureOption {
  value: string
  title: string
  sub?: string
}

interface PlanStructurePickerProps {
  options: PlanStructureOption[]
  selected: string | null
  onSelect: (value: string) => void
  heading?: string
}

export function PlanStructurePicker({
  options,
  selected,
  onSelect,
  heading = 'How would you like to plan?',
}: PlanStructurePickerProps) {
  return (
    <div style={{ paddingTop: 14 }}>
      <div style={{
        font: '600 11px/1.4 var(--gi-sans)',
        letterSpacing: '.05em',
        textTransform: 'uppercase',
        color: 'var(--gi-faint)',
        margin: '0 0 10px',
      }}>
        {heading}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {options.map((opt) => {
          const isSel = selected === opt.value
          return (
            <button
              type="button"
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              style={{
                display: 'flex',
                gap: 13,
                alignItems: 'flex-start',
                textAlign: 'left',
                width: '100%',
                cursor: 'pointer',
                border: `1.5px solid ${isSel ? 'var(--gi-teal)' : 'var(--gi-border)'}`,
                background: isSel ? 'rgba(26,107,114,.05)' : 'transparent',
                borderRadius: 11,
                padding: '13px 16px',
              }}
            >
              <span style={isSel
                ? {
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'var(--gi-teal)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 1,
                  }
                : {
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: '2px solid var(--gi-faint-border)',
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                {isSel && <Check size={12} strokeWidth={3.2} />}
              </span>
              <span>
                <span style={{ display: 'block', font: '600 15px/1.3 var(--gi-sans)', color: 'var(--gi-ink)' }}>
                  {opt.title}
                </span>
                {opt.sub && (
                  <span style={{ display: 'block', font: '400 13px/1.45 var(--gi-sans)', color: 'var(--gi-muted)', marginTop: 1 }}>
                    {opt.sub}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
