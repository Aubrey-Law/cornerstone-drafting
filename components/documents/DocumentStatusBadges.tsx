'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DocumentBadgeModel } from '@/lib/documentWorkspace'

const TONE_CLASS: Record<DocumentBadgeModel['tone'], string> = {
  neutral: 'text-muted-foreground',
  success: 'border-green/30 text-green',
  warning: 'border-amber-border bg-amber-bg text-amber',
  danger: 'border-destructive/30 text-destructive',
  info: 'border-primary/30 bg-primary/5 text-primary',
}

export function DocumentStatusBadges({ badges }: { badges: DocumentBadgeModel[] }) {
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map(badge => (
        <Badge key={badge.label} variant="outline" className={cn('text-[11px]', TONE_CLASS[badge.tone])}>
          {badge.label}
        </Badge>
      ))}
    </div>
  )
}
