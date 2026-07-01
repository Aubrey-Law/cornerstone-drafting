'use client'

import { ProgressRing } from './ProgressRing'
import { guidedIntroCardStyle } from './styles'

interface GuidedIntroCardProps {
  pct: number
  title: string
  subtitle: string
}

export function GuidedIntroCard({ pct, title, subtitle }: GuidedIntroCardProps) {
  return (
    <div style={guidedIntroCardStyle}>
      <ProgressRing pct={pct} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{
          fontWeight: 500,
          fontSize: 25,
          lineHeight: 1.2,
          color: 'var(--gi-heading)',
          margin: 0,
        }}>
          {title}
        </h1>
        <p style={{
          font: '400 14px/1.5 var(--gi-sans)',
          color: 'var(--gi-muted)',
          margin: '4px 0 0',
        }}>
          {subtitle}
        </p>
      </div>
    </div>
  )
}
