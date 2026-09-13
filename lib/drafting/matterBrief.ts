import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { draftPayloadFactSheet } from '@/lib/adminChat/prompts'
import { quoteUserContent } from '@/lib/anthropic'
import type { DraftPayload } from '@/lib/buildDraftPayload'

/**
 * The design sheet, as the Word add-in sees it.
 *
 * Deliberately a thin wrapper over `buildDraftPayload` + `draftPayloadFactSheet`
 * rather than its own reading of the design sheet. Those two already resolve
 * fiduciary slots to names, normalize the plan type, apply the design-sheet
 * defaults and mark every unresolved value `[UNKNOWN]` — and they are what the
 * admin chat drafts from. A second reader here would be a second set of answers
 * to "who is the successor trustee", drifting from the first the moment either
 * changed. Same argument the formatting pass makes for round-tripping the style
 * sweep through the server instead of reimplementing it in Office.js.
 */

/**
 * A ceiling on the fact sheet, not a target.
 *
 * The sheet is bounded by construction — a fixed field list and at most 40
 * review items — but two of its fields are attorney free text
 * (`special_provisions`, `ancillary_docs`) with no length limit of their own.
 * This is the backstop that keeps one pasted memo from crowding the open
 * document out of the context window.
 */
export const MAX_FACT_SHEET_CHARS = 24_000

export interface MatterBrief {
  matterId: string
  matterNumber: string | null
  clientName: string
  spouseName: string | null
  /** `individual`, `married_individual` or `married_joint`. */
  matterType: string
  practiceArea: string | null
  trustName: string | null
  /**
   * The normalized design sheet, as `[UNKNOWN]`-marked lines. Shown to the
   * attorney in the pane and sent to the model verbatim.
   */
  factSheet: string
  /** True when the sheet had to be cut to fit `MAX_FACT_SHEET_CHARS`. */
  truncated: boolean
}

export type MatterBriefResult =
  | { ok: true; brief: MatterBrief }
  | { ok: false; reason: string }

/** Exported for its own test; building a whole DraftPayload to reach it is not worth it. */
export function capFactSheet(full: string): { factSheet: string; truncated: boolean } {
  if (full.length <= MAX_FACT_SHEET_CHARS) return { factSheet: full, truncated: false }
  // Marked, never silently shortened: a sheet that stops mid-value would
  // otherwise read to the model as a value that simply ends there.
  return { factSheet: `${full.slice(0, MAX_FACT_SHEET_CHARS)}\n[TRUNCATED]`, truncated: true }
}

function toBrief(payload: DraftPayload): MatterBrief {
  const { factSheet, truncated } = capFactSheet(draftPayloadFactSheet(payload))

  return {
    matterId: payload.matter.id,
    matterNumber: payload.matter.matter_number,
    clientName: payload.client.full_name,
    spouseName: payload.spouse?.full_name ?? null,
    matterType: payload.matter.type,
    practiceArea: payload.matter.practice_area,
    trustName: payload.trust?.name ?? null,
    factSheet,
    truncated,
  }
}

/**
 * Never throws.
 *
 * A design sheet that is not ready is an ordinary state — the matter may not be
 * hired yet, or the sheet may not exist — and the caller has to be able to say
 * so rather than fail the request. The add-in in particular must not lose an
 * attorney's whole chat turn because the matter they linked turned out to be
 * unready; it degrades to document-only drafting and says which it did.
 *
 * `allowPartial` is deliberately NOT set. It would answer an unready matter
 * with a sheet of `[[ MISSING ]]` holes instead of an error, and a brief that
 * looks populated but is not is worse here than no brief at all.
 */
export async function buildMatterBrief(matterId: string): Promise<MatterBriefResult> {
  try {
    const payload = await buildDraftPayload(matterId)
    return { ok: true, brief: toBrief(payload) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('[matterBrief] design sheet unavailable', { matterId, reason })
    return { ok: false, reason }
  }
}

/**
 * The brief as it reaches the model.
 *
 * Fenced with `quoteUserContent` even though these are attorney-approved,
 * normalized values: the design sheet is seeded from client intake, so client
 * names, notes and special provisions are free text a client typed. That is
 * exactly the case its docstring names. The fencing makes the sheet data rather
 * than instructions; the surrounding lines are what make it authoritative.
 */
export function matterBriefPromptSection(brief: MatterBrief): string {
  return `You are drafting on matter ${brief.matterNumber ?? brief.matterId} for ${brief.clientName}.

The design sheet below is the firm's approved record of this matter and is the source of truth for every name, date, relationship and fiduciary appointment in it. Prefer it over the open document: where the two disagree, the document is out of date and the design sheet is what the attorney decided.

Non-invention rule, which outranks being helpful: use only the facts below. Never invent or infer a name, date, relationship, asset, tax conclusion or fiduciary appointment. A value shown as [UNKNOWN] is not yet decided — leave the document's existing placeholder in place, or write [UNKNOWN], and say in your reply that it needs the attorney. Guessing one is the single worst thing you can do here: it produces a document that reads as finished and is wrong.

${quoteUserContent('matter-design-sheet', brief.factSheet)}`
}
