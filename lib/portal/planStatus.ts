import { STAGES, stageLabel, type MatterStage } from '@/types/database'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { PortalMilestone, PortalTrack } from '@/lib/portal/progress'

/**
 * "Where is my plan?" The facts a status answer is drawn from, a plain
 * sentence set written from them without a model (always available, and the
 * ground the model's draft is held to), and the bounds on the model's draft.
 * Pure, so every sentence a client could be shown is testable.
 */

export interface PlanStatusFacts {
  stage: MatterStage
  stageLabel: string
  track: PortalTrack
  /** The portal's milestones, as the tracker shows them. */
  milestones: ReadonlyArray<Pick<PortalMilestone, 'key' | 'label' | 'state'>>
  nextAppointment: { startsAt: string; typeLabel: string | null } | null
  /** Trust funding, when the plan has assets to retitle. */
  funding: { total: number; funded: number; outstanding: number } | null
  /** Lifecycle requirements still owed by the client, in the registry's words. */
  clientFollowUp: readonly string[]
  /**
   * Whether the client has submitted the questionnaire. False keeps the
   * status on that open questionnaire. Omit when unknown so the stage
   * sentences stay as they are.
   */
  intakeComplete?: boolean
  /** When the matter last changed stage, when known. */
  stageChangedAt: string | null
  /** The firm's name and the attorney's short name, for the sentences. */
  firmName: string
  attorneyShortName: string
}

/** The one-line version of a stage for a client, before any detail. */
const STAGE_SENTENCE: Record<MatterStage, string> = {
  intake: 'We are gathering the information we need to design your plan.',
  intake_review: 'We have your intake and are reviewing it before the design work begins.',
  design: 'We are designing your plan: who inherits, who is in charge, and how it is structured.',
  drafting: 'Your documents are being drafted from the design we settled on.',
  client_review: 'Your draft documents are ready for you to review.',
  revision: 'We are revising your drafts with the changes you asked for.',
  drafts_approved: 'Your drafts are approved and we are arranging the signing.',
  signing_scheduled: 'Your signing is scheduled.',
  signing_complete: 'Your documents are signed.',
  post_execution: 'Your documents are signed, and we are completing the steps that follow the signing.',
  funding: 'Your plan is signed, and we are moving your assets into it.',
  closed: 'Your matter is complete.',
}

/** What usually comes next, in the client's terms. */
const NEXT_STEP: Partial<Record<MatterStage, string>> = {
  intake: 'Once your intake is complete we will review it and set up the design meeting.',
  intake_review: 'Next is the design meeting, where we decide the shape of your plan together.',
  design: 'Once the design is settled we draft the documents.',
  drafting: 'When the drafts are ready we will share them in your portal for review.',
  client_review: 'Send any questions or changes through Messages; once you approve, we schedule the signing.',
  revision: 'We will share the revised drafts for your approval, and then schedule the signing.',
  drafts_approved: 'We will confirm a signing date with you.',
  signing_scheduled: 'Bring a photo ID; we will walk you through each document at the signing.',
  signing_complete: 'We will file the originals and send you copies, then turn to funding your trust where that applies.',
  post_execution: 'We will let you know as each follow-up step is done.',
  funding: 'We will tell you as each asset is retitled and what, if anything, we need from you for the rest.',
}

const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: FIRM_TIMEZONE })

function appointmentSentence(facts: PlanStatusFacts): string | null {
  if (!facts.nextAppointment) return null
  const when = DATE.format(new Date(facts.nextAppointment.startsAt))
  const what = facts.nextAppointment.typeLabel?.trim()
  return what ? `Your next appointment, ${what.toLowerCase()}, is on ${when}.` : `Your next appointment with us is on ${when}.`
}

function fundingSentence(facts: PlanStatusFacts): string | null {
  const funding = facts.funding
  if (!funding || funding.total === 0) return null
  if (funding.outstanding === 0) return `All ${funding.total} of your assets are now titled to the plan.`
  return `${funding.funded} of ${funding.total} assets ${funding.funded === 1 ? 'is' : 'are'} titled to the plan so far, with ${funding.outstanding} still to go.`
}

function followUpSentence(facts: PlanStatusFacts): string | null {
  const items = facts.clientFollowUp.filter(Boolean).slice(0, 3)
  if (items.length === 0) return null
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `From you we still need: ${list.charAt(0).toLowerCase()}${list.slice(1)}.`
}

/**
 * An open questionnaire is the story, even after the matter stage has moved
 * on. A closed matter keeps its own sentence. Unknown intake leaves the
 * stage sentences untouched.
 */
function questionnaireStillOpen(facts: PlanStatusFacts): boolean {
  return facts.intakeComplete === false && facts.stage !== 'closed'
}

const OPEN_QUESTIONNAIRE_SENTENCE = 'We are working from what we have, and your questionnaire is still open.'

/**
 * The status in plain words, with no model involved. Where you are, what is
 * next, what is booked, how funding stands, and what we need from you; only
 * the sentences the facts support.
 */
export function describePlanStatus(facts: PlanStatusFacts): string {
  const intakeOpen = questionnaireStillOpen(facts)
  const sentences = [
    intakeOpen
      ? OPEN_QUESTIONNAIRE_SENTENCE
      : STAGE_SENTENCE[facts.stage] ?? `Your matter is in the ${facts.stageLabel.toLowerCase()} stage.`,
    appointmentSentence(facts),
    facts.stage === 'funding' || facts.stage === 'post_execution' || facts.stage === 'signing_complete' ? fundingSentence(facts) : null,
    followUpSentence(facts),
    intakeOpen
      ? null
      : facts.stage === 'closed' ? 'Your documents and messages stay available here.' : NEXT_STEP[facts.stage] ?? null,
  ]
  return sentences.filter((sentence): sentence is string => Boolean(sentence)).join(' ')
}

/**
 * A short fingerprint of what the update would say, so a stage change that
 * changes nothing the client would notice is not proposed twice, and a new
 * appointment or a funding step is.
 */
export function planStatusDigest(facts: PlanStatusFacts): string {
  const parts = [
    facts.stage,
    facts.milestones.filter(m => m.state === 'completed').map(m => m.key).join('+'),
    facts.nextAppointment?.startsAt.slice(0, 10) ?? '-',
    facts.funding ? `${facts.funding.funded}/${facts.funding.total}` : '-',
    facts.clientFollowUp.length,
  ]
  if (facts.intakeComplete === false) parts.push('intake-open')
  return parts.join(':')
}

export const PLAN_STATUS_MAX_CHARS = 1_200
export const PLAN_STATUS_MIN_CHARS = 40

export const PLAN_STATUS_SYSTEM_PROMPT = `You write a short status update to an estate-planning client from their attorney's firm, answering "where is my plan?".

You are given the facts the firm's records hold and a plain draft written from them. Rewrite it as a warm, clear note in the firm's voice: second person, two to five short sentences, no legal citations, no fees, no jargon.

Rules:
- Say only what the facts say. Never add a date, a promise about timing, a document name or a step the facts do not contain.
- Keep every fact the plain draft states; you may reorder and reword.
- Do not sign off or add a greeting; the portal shows who it is from.
- Output ONLY one JSON object: { "body": string }`

/** Bounds the model's rewrite so a long or odd answer cannot reach the client. */
export function coercePlanStatusDraft(parsed: unknown, fallback: string): string {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
  const body = (parsed as Record<string, unknown>).body
  if (typeof body !== 'string') return fallback
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length < PLAN_STATUS_MIN_CHARS) return fallback
  return flat.length > PLAN_STATUS_MAX_CHARS ? `${flat.slice(0, PLAN_STATUS_MAX_CHARS - 1).trimEnd()}…` : flat
}

export function isMatterStage(value: unknown): value is MatterStage {
  return typeof value === 'string' && STAGES.some(stage => stage.key === value)
}

export { stageLabel }
