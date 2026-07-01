'use client'

import { Check } from 'lucide-react'
import {
  DESIGN_DOCUMENT_LABELS,
  type DesignDocumentInclusions,
  type DesignDocumentKey,
} from '@/lib/designSheetDocumentInclusions'

export interface DocumentPickerGroup {
  label: string
  keys: DesignDocumentKey[]
}

const DEFAULT_DOC_GROUPS: DocumentPickerGroup[] = [
  { label: 'Core estate', keys: ['trust', 'will', 'deed', 'young_adult_estate_plan'] },
  { label: 'Decision-making', keys: ['dpoa'] },
  { label: 'Health care', keys: ['healthcare'] },
]

interface DocumentPickerProps {
  inclusions: DesignDocumentInclusions
  onToggle: (key: DesignDocumentKey, value: boolean) => void
  groups?: DocumentPickerGroup[]
}

export function DocumentPicker({
  inclusions,
  onToggle,
  groups = DEFAULT_DOC_GROUPS,
}: DocumentPickerProps) {
  return (
    <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map((group) => (
        <div key={group.label}>
          <div style={{
            font: '600 11px/1.4 var(--gi-sans)',
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: 'var(--gi-faint)',
            marginBottom: 9,
          }}>
            {group.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {group.keys.map((key) => {
              const on = inclusions[key]
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => onToggle(key, !on)}
                  style={on
                    ? {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        font: '600 13px/1 var(--gi-sans)',
                        color: 'var(--gi-teal-deep)',
                        background: 'rgba(26,107,114,.08)',
                        border: '1px solid rgba(26,107,114,.35)',
                        padding: '8px 13px',
                        borderRadius: 999,
                        cursor: 'pointer',
                      }
                    : {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        font: '500 13px/1 var(--gi-sans)',
                        color: 'var(--gi-muted)',
                        background: 'transparent',
                        border: '1px solid var(--gi-border)',
                        padding: '8px 13px',
                        borderRadius: 999,
                        cursor: 'pointer',
                      }}
                >
                  {on
                    ? <Check size={12} strokeWidth={3} />
                    : <span style={{ width: 13, height: 13, border: '2px solid var(--gi-faint-border)', borderRadius: 4 }} />}
                  {DESIGN_DOCUMENT_LABELS[key]}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export { DEFAULT_DOC_GROUPS }
