'use client'

import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface GuidedSectionHandle {
  scrollIntoView: () => void
}

interface GuidedSectionProps {
  id?: string
  number: number
  title: string
  subtitle?: string
  complete: boolean
  open: boolean
  upcoming?: boolean
  onToggle: () => void
  onContinue?: () => void
  continueLabel?: string
  children?: ReactNode
}

export const GuidedSection = forwardRef<GuidedSectionHandle, GuidedSectionProps>(
  function GuidedSection({
    id,
    number,
    title,
    subtitle,
    complete,
    open,
    upcoming = false,
    onToggle,
    onContinue,
    continueLabel = 'Continue to next section',
    children,
  }, ref) {
    const rootRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      scrollIntoView() {
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    }))

    if (upcoming) {
      return (
        <div
          ref={rootRef}
          id={id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--gi-surface)',
            border: '1px solid var(--gi-border)',
            borderRadius: 14,
            padding: '17px 22px',
            boxShadow: '0 1px 2px rgba(15,23,42,.04)',
            opacity: 0.72,
          }}
        >
          <span style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            border: '2px solid #d1d5db',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: '700 12px/1 var(--gi-sans)',
            color: 'var(--gi-faint)',
          }}>
            {number}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ font: '600 15px/1.3 var(--gi-sans)', color: '#374151' }}>{title}</div>
          </div>
          <ChevronDown size={18} style={{ color: 'var(--gi-faint)' }} strokeWidth={2} />
        </div>
      )
    }

    return (
      <div
        ref={rootRef}
        id={id}
        style={{
          background: 'var(--gi-surface)',
          border: `1px solid ${open ? 'var(--gi-border-open)' : 'var(--gi-border)'}`,
          borderRadius: 14,
          boxShadow: '0 1px 2px rgba(15,23,42,.04)',
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '17px 22px',
            cursor: 'pointer',
            width: '100%',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
          }}
          aria-expanded={open}
        >
          <span style={complete
            ? {
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'var(--gi-teal)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }
            : {
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '2px solid var(--gi-teal)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: '700 13px/1 var(--gi-sans)',
                color: 'var(--gi-teal)',
              }}>
            {complete ? <Check size={14} strokeWidth={3} /> : number}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ font: '600 16px/1.3 var(--gi-sans)', color: 'var(--gi-ink)' }}>{title}</div>
            {subtitle && (
              <div style={{ font: '400 12.5px/1.4 var(--gi-sans)', color: 'var(--gi-faint)' }}>
                {subtitle}
              </div>
            )}
          </div>
          <span style={{ font: '600 13px/1 var(--gi-sans)', color: 'var(--gi-teal)' }}>
            {open ? 'Close' : 'Edit'}
          </span>
        </button>
        {open && (
          <div style={{ padding: '4px 22px 22px', borderTop: '1px solid var(--gi-divider)' }}>
            {children}
            {onContinue && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gi-divider)' }}>
                <button
                  type="button"
                  onClick={onContinue}
                  style={{
                    background: 'var(--gi-teal)',
                    color: '#fff',
                    border: 'none',
                    font: '600 14px/1 var(--gi-sans)',
                    cursor: 'pointer',
                    padding: '12px 18px',
                    borderRadius: 10,
                    width: '100%',
                  }}
                >
                  {continueLabel} →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  },
)
