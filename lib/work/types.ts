import type { TodayAppointment } from '@/lib/queries/today'

export const WORK_SOURCE_TYPES = [
  'task',
  'lead_action',
  'matter_action',
  'email',
  'sms',
  'portal_message',
  'intake_review',
  'document_review',
  'billing',
  'appointment_prep',
  'automation_failure',
] as const

export type WorkSourceType = (typeof WORK_SOURCE_TYPES)[number]
export type WorkOwner = 'firm' | 'client' | 'automation'
export type WorkState = 'open' | 'blocked' | 'waiting' | 'snoozed'
export type PriorityBand = 0 | 1 | 2 | 3 | 4

export type PriorityReasonCode =
  | 'hard_deadline_overdue'
  | 'due_overdue'
  | 'due_today'
  | 'due_soon'
  | 'client_waiting'
  | 'stage_sla'
  | 'unread_inbound'
  | 'appointment_soon'
  | 'automation_failed'
  | 'billing_overdue'
  | 'intake_ready'
  | 'document_review_ready'
  | 'intake_unsent'
  | 'high_priority'
  | 'blocked'
  | 'snoozed'
  | 'waiting_external'
  | 'planned'

export interface PriorityReason {
  code: PriorityReasonCode
  label: string
}

export interface WorkEvidence {
  sourceType: WorkSourceType
  sourceId: string
  href: string
}

export interface WorkItem {
  workKey: string
  sourceType: WorkSourceType
  sourceIds: string[]
  evidence: WorkEvidence[]
  record: { type: 'lead' | 'matter' | 'firm'; id?: string; name: string }
  title: string
  actionLabel: string
  href: string
  owner: WorkOwner
  state: WorkState
  priorityBand: PriorityBand
  priorityReasons: PriorityReason[]
  dueAt?: string
  hardDueAt?: string
  estimateMinutes: number
  batchTag?: string
  actionKey?: string

  /** Deterministic tie-break signals; never produced by an LLM. */
  clientWaitingSince?: string
  appointmentAt?: string
  staleSince?: string
  taskPriority?: 'high' | 'normal' | 'low'
}

export interface WorkItemOverride {
  work_key: string
  state: WorkState
  snoozed_until: string | null
  assigned_to: string | null
  note: string | null
}

export interface WorkPreferences {
  maxMustDo: number
  focusCapacityMinutes: number
  interruptionBufferPercent: number
  focusBlockMinutes: number
  maxFocusBlockMinutes: number
  adminBatchMinutes: 15 | 30
  workdayStart: string
  workdayEnd: string
}

export const DEFAULT_WORK_PREFERENCES: WorkPreferences = {
  maxMustDo: 3,
  focusCapacityMinutes: 240,
  interruptionBufferPercent: 20,
  focusBlockMinutes: 50,
  maxFocusBlockMinutes: 60,
  adminBatchMinutes: 30,
  workdayStart: '09:00',
  workdayEnd: '17:00',
}

export type PlanLane = 'now' | 'must_do' | 'suggested' | 'communication' | 'later'

export interface SuggestedBlock {
  workKey: string
  startAt: string
  endAt: string
  minutes: number
}

export interface DailyPlanPreview {
  date: string
  now: WorkItem | null
  mustDo: WorkItem[]
  suggested: WorkItem[]
  communication: WorkItem[]
  waiting: WorkItem[]
  later: WorkItem[]
  blocks: SuggestedBlock[]
  capacityMinutes: number
  plannedMinutes: number
  criticalMinutes: number
  overloadMinutes: number
  overload: boolean
  appointments: TodayAppointment[]
}

export interface WorkGraphResult {
  generatedAt: string
  items: WorkItem[]
  appointments: TodayAppointment[]
  sourceErrors: string[]
  /** Aggregate adapter timings only; never includes record identifiers or content. */
  sourceDurationsMs?: Record<string, number>
}
