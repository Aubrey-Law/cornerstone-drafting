'use client'

interface ProgressRingProps {
  pct: number
}

export function ProgressRing({ pct }: ProgressRingProps) {
  const ringOffset = (97.4 * (1 - pct / 100)).toFixed(1)
  return (
    <div style={{ position: 'relative', width: 54, height: 54, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ width: 54, height: 54, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--gi-divider)" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="var(--gi-teal)"
          strokeWidth="4"
          strokeDasharray="97.4"
          strokeDashoffset={ringOffset}
          strokeLinecap="round"
        />
      </svg>
      <span style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: '700 13px/1 var(--gi-sans)',
        color: 'var(--gi-teal)',
      }}>
        {pct}%
      </span>
    </div>
  )
}
