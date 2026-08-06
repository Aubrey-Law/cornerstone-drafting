import { Activity, CheckCircle2, FileText, Info, Send, type LucideIcon } from 'lucide-react'
import type { ActivityEventType, MatterActivity } from '@/types/database'

/**
 * Icons, tones and titles for matter activity events. Shared by the Activity
 * tab and the facts panel's Activity section so one event never renders two
 * different ways.
 */

export const ACTIVITY_EVENT_LABELS: Partial<Record<MatterActivity['event_type'], string>> = {
  intake_sent: 'Intake sent',
  intake_completed: 'Intake completed',
  draft_generated: 'Drafts generated',
  stage_changed: 'Stage changed',
}

export interface EventMeta {
  icon: LucideIcon
  color: string
  label: string
}

export const EVENT_META: Partial<Record<ActivityEventType, EventMeta>> = {
  stage_changed: { icon: Activity, color: 'text-primary bg-primary/10', label: 'Stage changed activity' },
  intake_sent: { icon: Send, color: 'text-primary bg-primary/10', label: 'Intake sent activity' },
  intake_completed: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Intake completed activity' },
  email_sent: { icon: Send, color: 'text-muted-foreground bg-muted', label: 'Email sent activity' },
  draft_generated: { icon: FileText, color: 'text-primary bg-primary/10', label: 'Draft generated activity' },
  draft_promoted_to_review: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Draft promoted to review activity' },
  matter_created: { icon: Info, color: 'text-muted-foreground bg-muted', label: 'Matter activity' },
}

export function eventMetaFor(type: ActivityEventType): EventMeta {
  return EVENT_META[type] ?? EVENT_META.matter_created!
}

export interface DocumentReference {
  id: string
  name: string
}

export function documentReferences(metadata: MatterActivity['metadata']): DocumentReference[] {
  if (!metadata || !Array.isArray(metadata.documentRefs)) return []
  return metadata.documentRefs.filter(
    (value): value is DocumentReference =>
      typeof value === 'object'
      && value !== null
      && typeof (value as Record<string, unknown>).id === 'string'
      && typeof (value as Record<string, unknown>).name === 'string',
  )
}

export function legacyDocumentNames(metadata: MatterActivity['metadata']): string[] {
  return metadata && Array.isArray(metadata.documents)
    ? metadata.documents.filter((value): value is string => typeof value === 'string')
    : []
}

/** Drafts carry their document count in metadata; everything else uses its title. */
export function draftDocumentCount(event: MatterActivity): number {
  if (event.event_type !== 'draft_generated') return 0
  return documentReferences(event.metadata).length || legacyDocumentNames(event.metadata).length
}

export function activityEventTitle(event: MatterActivity): string {
  const drafts = draftDocumentCount(event)
  if (drafts > 0) return `Generated ${drafts} drafts`
  return event.title || ACTIVITY_EVENT_LABELS[event.event_type] || 'Matter updated'
}
