'use client'

interface FlagPillProps {
  tone: 'amber' | 'blue'
  text: string
  onClick?: () => void
}

export function FlagPill({ tone, text, onClick }: FlagPillProps) {
  const style = tone === 'amber'
    ? { background: 'var(--gi-amber-bg)', border: '1px solid var(--gi-amber-border)', color: 'var(--gi-amber)' }
    : { background: 'var(--gi-info-bg)', border: '1px solid var(--gi-info-border)', color: 'var(--gi-info-text)' }

  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        font: '500 12px/1.45 var(--gi-sans)',
        textAlign: 'left',
        cursor: onClick ? 'pointer' : undefined,
        width: '100%',
        ...style,
      }}
    >
      {text}
    </Tag>
  )
}
