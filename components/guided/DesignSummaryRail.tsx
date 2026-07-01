'use client'

import { Check } from 'lucide-react'
import type { DesignReadinessBlocker } from '@/lib/designSheetReadiness'
import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { DESIGN_DOCUMENT_LABELS, type DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import { FlagPill } from './FlagPill'
import {
  guidedCardStyle,
  guidedKickerStyle,
  guidedPrimaryButtonStyle,
  guidedSubLabelStyle,
} from './styles'

export interface SummarySectionItem {
  id: string
  label: string
  status: 'complete' | 'attention' | 'override' | 'none'
  missingCount?: number
}

interface DesignSummaryRailProps {
  trustName: string
  peopleLine: string
  planTypeLabel?: string
  documentInclusions: DesignDocumentInclusions
  selectedDocKeys: DesignDocumentKey[]
  sections: SummarySectionItem[]
  readinessComplete: boolean
  readinessCompletedCount: number
  readinessTotal: number
  blockerDetails: Array<{ id: string; label: string; blockers: DesignReadinessBlocker[] }>
  onSectionClick: (sectionId: string) => void
  onBlockerClick: (blocker: DesignReadinessBlocker) => void
  onGenerate?: () => void
  generateLabel?: string
  generateDisabled?: boolean
  generateDisabledTitle?: string
  pendingFiduciaries?: string[]
  /** Highlights the active section in the checklist (fast-entry scroll-spy). */
  activeSectionId?: string
  stickyTop?: number
  /** `sticky` pins within the viewport; `column` fills a scrolling sidebar column. */
  layout?: 'sticky' | 'column'
}

export function DesignSummaryRail({
  trustName,
  peopleLine,
  planTypeLabel,
  documentInclusions,
  selectedDocKeys,
  sections,
  readinessComplete,
  readinessCompletedCount,
  readinessTotal,
  blockerDetails,
  onSectionClick,
  onBlockerClick,
  onGenerate,
  generateLabel = 'Generate drafts →',
  generateDisabled = false,
  generateDisabledTitle,
  pendingFiduciaries = [],
  activeSectionId,
  stickyTop = 16,
  layout = 'sticky',
}: DesignSummaryRailProps) {
  const isColumn = layout === 'column'
  const docRows: Array<{ key: DesignDocumentKey; label: string }> = [
    { key: 'trust', label: DESIGN_DOCUMENT_LABELS.trust },
    { key: 'will', label: DESIGN_DOCUMENT_LABELS.will },
    { key: 'dpoa', label: DESIGN_DOCUMENT_LABELS.dpoa },
    { key: 'healthcare', label: DESIGN_DOCUMENT_LABELS.healthcare },
    { key: 'deed', label: DESIGN_DOCUMENT_LABELS.deed },
  ]

  return (
    <aside
      style={{
        width: '100%',
        minWidth: 280,
        maxWidth: 320,
        position: isColumn ? 'relative' : 'sticky',
        top: isColumn ? undefined : stickyTop,
        alignSelf: 'flex-start',
        maxHeight: isColumn ? undefined : `calc(100vh - ${stickyTop + 24}px)`,
        overflowY: isColumn ? 'visible' : 'auto',
        overscrollBehavior: isColumn ? undefined : 'contain',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        paddingBottom: 8,
      }}
    >
      <div style={guidedCardStyle}>
        <div style={guidedKickerStyle}>Your plan so far</div>
        <div style={{
          fontWeight: 500,
          fontSize: 19,
          color: 'var(--gi-heading)',
          marginBottom: 16,
        }}>
          {trustName}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {planTypeLabel && (
            <div>
              <div style={guidedSubLabelStyle}>Structure</div>
              <span style={{
                display: 'inline-block',
                font: '600 12px/1.3 var(--gi-sans)',
                color: 'var(--gi-teal)',
                background: 'rgba(26,107,114,.1)',
                border: '1px solid rgba(26,107,114,.3)',
                padding: '6px 11px',
                borderRadius: 999,
              }}>
                {planTypeLabel}
              </span>
            </div>
          )}
          <div>
            <div style={guidedSubLabelStyle}>People</div>
            <div style={{ font: '400 13px/1.6 var(--gi-sans)', color: 'var(--gi-strong)' }}>
              {peopleLine || '—'}
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={guidedSubLabelStyle}>Documents</span>
              <span style={{ font: '600 11px/1 var(--gi-sans)', color: 'var(--gi-teal)' }}>
                {selectedDocKeys.length} selected
              </span>
            </div>
            <div style={{ font: '400 12.5px/1.6 var(--gi-sans)', color: 'var(--gi-strong)' }}>
              {selectedDocKeys.map((k) => DESIGN_DOCUMENT_LABELS[k]).join(' · ') || 'None selected yet'}
            </div>
          </div>
        </div>
      </div>

      <div style={guidedCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ font: '600 13px/1 var(--gi-sans)', color: 'var(--gi-ink)' }}>Design readiness</span>
          <span style={{
            font: '700 10px/1 var(--gi-sans)',
            color: readinessComplete ? '#15803d' : 'var(--gi-amber)',
            background: readinessComplete ? '#f0fdf4' : 'var(--gi-amber-bg)',
            padding: '2px 7px',
            borderRadius: 999,
          }}>
            {readinessCompletedCount}/{readinessTotal}
          </span>
        </div>
        {!readinessComplete && blockerDetails.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 12 }}>
            {blockerDetails.flatMap((group) =>
              group.blockers.map((blocker) => (
                <FlagPill
                  key={blocker.id}
                  tone={blocker.category === 'client-decision' ? 'amber' : 'blue'}
                  text={blocker.label}
                  onClick={() => onBlockerClick(blocker)}
                />
              )),
            )}
          </div>
        )}
        {readinessComplete && (
          <div style={{ font: '400 12.5px/1.45 var(--gi-sans)', color: 'var(--gi-muted)', marginBottom: 12 }}>
            Ready to save and generate drafts.
          </div>
        )}
      </div>

      <div style={guidedCardStyle}>
        <div style={guidedKickerStyle}>Sections</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sections.map((item) => {
            const isActive = activeSectionId === item.id
            return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionClick(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 6px',
                background: isActive ? 'rgba(26,107,114,.08)' : 'transparent',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                textAlign: 'left',
                font: `${isActive ? 600 : 500} 12.5px/1.35 var(--gi-sans)`,
                color: isActive
                  ? 'var(--gi-teal)'
                  : item.status === 'attention'
                    ? 'var(--gi-amber)'
                    : 'var(--gi-strong)',
              }}
            >
              {item.status === 'complete' && <Check size={13} style={{ color: 'var(--gi-teal)', flexShrink: 0 }} />}
              {item.status === 'attention' && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gi-amber)', flexShrink: 0 }} />
              )}
              {item.status === 'override' && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706', flexShrink: 0 }} />
              )}
              {(item.status === 'none') && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--gi-faint-border)', flexShrink: 0 }} />
              )}
              <span style={{ flex: 1 }}>{item.label}</span>
            </button>
            )
          })}
        </div>
      </div>

      <div style={guidedCardStyle}>
        <div style={guidedKickerStyle}>Document checklist</div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docRows.map((row) => {
            const on = documentInclusions[row.key]
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onSectionClick(row.key === 'trust' ? 'plan-design' : row.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 0',
                    font: '400 12px/1.4 var(--gi-sans)',
                    color: on ? 'var(--gi-strong)' : 'var(--gi-faint)',
                  }}
                >
                  {on ? <Check size={12} style={{ color: 'var(--gi-teal)' }} /> : <span style={{ width: 12 }}>—</span>}
                  {row.label}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {pendingFiduciaries.length > 0 && (
        <div style={guidedCardStyle}>
          <div style={guidedKickerStyle}>Pending fiduciaries</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingFiduciaries.map((key) => (
              <li key={key} style={{ font: '400 12px/1.4 var(--gi-sans)', color: 'var(--gi-amber)' }}>
                {key.replace(/_/g, ' ')} — awaiting client
              </li>
            ))}
          </ul>
        </div>
      )}

      {onGenerate && (
        <button
          type="button"
          onClick={onGenerate}
          disabled={generateDisabled}
          title={generateDisabled ? generateDisabledTitle : undefined}
          style={{
            ...guidedPrimaryButtonStyle,
            opacity: generateDisabled ? 0.5 : 1,
            cursor: generateDisabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {generateLabel}
        </button>
      )}
    </aside>
  )
}
