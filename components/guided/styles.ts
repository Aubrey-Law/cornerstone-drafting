import type { CSSProperties } from 'react'

export const guidedPageStyle: CSSProperties = {
  minHeight: '100%',
  background: 'var(--gi-page)',
  padding: '26px 20px 60px',
}

export const guidedEmbeddedPageStyle: CSSProperties = {
  minHeight: '100%',
  background: 'var(--gi-page)',
  padding: '20px 16px 40px',
}

export const guidedCardStyle: CSSProperties = {
  background: 'var(--gi-surface)',
  border: '1px solid var(--gi-border)',
  borderRadius: 14,
  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
  padding: '20px',
}

export const guidedKickerStyle: CSSProperties = {
  font: '600 11px/1.4 var(--gi-sans)',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--gi-faint)',
  marginBottom: 3,
}

export const guidedSubLabelStyle: CSSProperties = {
  font: '600 11px/1.4 var(--gi-sans)',
  color: 'var(--gi-muted)',
  marginBottom: 6,
}

export const guidedPillStyle: CSSProperties = {
  display: 'inline-block',
  font: '600 12px/1.3 var(--gi-sans)',
  color: 'var(--gi-teal)',
  background: 'rgba(26,107,114,.1)',
  border: '1px solid rgba(26,107,114,.3)',
  padding: '6px 11px',
  borderRadius: 999,
}

export const guidedPrimaryButtonStyle: CSSProperties = {
  background: 'var(--gi-teal)',
  color: '#fff',
  border: 'none',
  font: '600 14px/1 var(--gi-sans)',
  cursor: 'pointer',
  padding: 14,
  borderRadius: 10,
  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
  width: '100%',
}

export const guidedSecondaryButtonStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--gi-teal)',
  border: '1px solid var(--gi-border)',
  font: '600 13px/1 var(--gi-sans)',
  cursor: 'pointer',
  padding: '8px 14px',
  borderRadius: 8,
}

export const guidedIntroCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  background: 'var(--gi-surface)',
  border: '1px solid var(--gi-border)',
  borderRadius: 14,
  padding: '20px 24px',
  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
}
