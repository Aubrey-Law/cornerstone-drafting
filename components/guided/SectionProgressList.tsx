'use client'

import { Check } from 'lucide-react'
import { guidedCardStyle } from './styles'

export interface SectionProgressItem {
  id: string
  title: string
  complete: boolean
  /** Minutes; omitted for sections without an estimate (e.g. attorney sections). */
  timeEstimate?: number
}

interface SectionProgressListProps {
  items: SectionProgressItem[]
  /** Id of the currently expanded section, or '' when all are collapsed. */
  openId: string
  onSelect: (id: string) => void
}

/**
 * Client-mode rail card: a progress map over the same sections shown in the
 * main column. Selecting a row toggles that section open in the interview.
 */
export function SectionProgressList({ items, openId, onSelect }: SectionProgressListProps) {
  const done = items.filter(i => i.complete).length

  return (
    <div style={guidedCardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <span style={{ font: '600 13px/1 var(--gi-sans)', color: 'var(--gi-ink)' }}>Your progress</span>
        <span style={{ font: '600 12px/1 var(--gi-sans)', color: 'var(--gi-teal)' }}>
          {done} of {items.length} done
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map(item => {
          const open = item.id === openId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                padding: '6px 0',
              }}
              aria-current={open ? 'step' : undefined}
            >
              <StatusDot complete={item.complete} open={open} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: `${open ? 600 : 400} 12.5px/1.35 var(--gi-sans)`,
                  color: open ? 'var(--gi-teal)' : 'var(--gi-strong)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title}
              </span>
              {!item.complete && item.timeEstimate != null && (
                <span style={{ font: '400 11.5px/1 var(--gi-sans)', color: 'var(--gi-faint)', flexShrink: 0 }}>
                  ~{item.timeEstimate} min
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Matches the section-header circle language: filled = done, ring = open, faint ring = todo. */
function StatusDot({ complete, open }: { complete: boolean; open: boolean }) {
  const base = {
    width: 16,
    height: 16,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const

  if (complete) {
    return (
      <span style={{ ...base, background: 'var(--gi-teal)', color: '#fff' }}>
        <Check size={10} strokeWidth={3} />
      </span>
    )
  }
  return (
    <span
      style={{
        ...base,
        border: `2px solid ${open ? 'var(--gi-teal)' : 'var(--gi-faint-border)'}`,
      }}
    />
  )
}
