import { DOCUMENT_KINDS, documentLabel, requirementsFor, type DocumentKind } from '@/lib/execution/requirements'

/**
 * What a scan of an executed original shows, as the model reads it and as the
 * attorney confirms it. Pure: the bounds on the model's answer, the name the
 * filed scan gets, and the comparison against what the document needed.
 */

export interface ScanReading {
  kind: DocumentKind | null
  /** YYYY-MM-DD as written on the signature page, or null when not legible. */
  signedOn: string | null
  signers: string[]
  witnessCount: number
  witnessNames: string[]
  notarized: boolean
  notaryName: string | null
  /** The self-proving affidavit on a will, completed and notarised. */
  selfProvingAffidavit: boolean
  /** Signature lines that look blank, pages that look missing, dates that disagree. */
  issues: string[]
  /** 0 to 1, the model's own confidence in the kind and the signing date. */
  confidence: number
}

export const EMPTY_SCAN_READING: ScanReading = {
  kind: null, signedOn: null, signers: [], witnessCount: 0, witnessNames: [], notarized: false,
  notaryName: null, selfProvingAffidavit: false, issues: [], confidence: 0,
}

export const SCAN_READING_SYSTEM_PROMPT = `You read a scan of a signed Massachusetts estate-planning document and report what the paper shows. You are reading, not judging: report what is written and signed, and flag what you cannot see.

Output ONLY one JSON object:
{
  "kind": one of ${DOCUMENT_KINDS.join(' | ')} | null,
  "signed_on": "YYYY-MM-DD" | null,
  "signers": [ string ],
  "witness_count": number,
  "witness_names": [ string ],
  "notarized": boolean,
  "notary_name": string | null,
  "self_proving_affidavit": boolean,
  "issues": [ string ],
  "confidence": number
}

Rules:
- "kind": the document's own title decides. A pour-over will is a will; a certificate of trust is not a trust; a declaration of homestead is not a deed. Null when the title is not legible.
- "signed_on": the date written beside the principal signature, as the document is dated. Null when blank or illegible; never infer it from a notary stamp alone.
- "signers": the people who signed as principal (testator, settlor, trustee, principal, grantor), as printed under their signature lines.
- "witness_count": how many witness signature lines are actually signed, not how many are printed.
- "notarized": true only when an acknowledgment or jurat is completed with a notary signature and seal or stamp.
- "self_proving_affidavit": true only for a will whose affidavit is signed by the testator, both witnesses and the notary.
- "issues": every signature line that looks blank, a date that disagrees with another on the same document, a page that appears to be missing, or writing you cannot read. Empty when the document looks complete.
- "confidence": 0 to 1 for the kind and the signing date together.
- Never invent a name or a date that is not on the page.`

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day: "2026-02-30" is not one, whatever Date.parse makes of it. */
function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function names(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => text(item, 120)).filter((item): item is string => Boolean(item)).slice(0, max)
}

/** Bounds the model's answer so a misread scan cannot write anything a person did not confirm. */
export function coerceScanReading(parsed: unknown): ScanReading {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_SCAN_READING
  const value = parsed as Record<string, unknown>
  const kind = typeof value.kind === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value.kind) ? value.kind as DocumentKind : null
  const signedOnRaw = text(value.signed_on, 10)
  const signedOn = signedOnRaw && isCalendarDate(signedOnRaw) ? signedOnRaw : null
  const witnessCount = typeof value.witness_count === 'number' && Number.isFinite(value.witness_count)
    ? Math.max(0, Math.min(4, Math.round(value.witness_count)))
    : 0
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : 0
  return {
    kind,
    signedOn,
    signers: names(value.signers, 4),
    witnessCount,
    witnessNames: names(value.witness_names, 4),
    notarized: value.notarized === true,
    notaryName: text(value.notary_name, 120),
    selfProvingAffidavit: value.self_proving_affidavit === true,
    issues: names(value.issues, 10),
    confidence,
  }
}

/** The filed scan's name: `2026-10-09 Executed - Will - Pat Smith.pdf`. */
export function executedDocumentName(input: { reading: ScanReading; clientName: string | null; originalName: string; fallbackDate: string }): string {
  const extension = (input.originalName.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'pdf').toLowerCase()
  const date = input.reading.signedOn ?? input.fallbackDate
  const label = input.reading.kind ? documentLabel(input.reading.kind) : 'Unidentified document'
  const who = input.clientName?.trim() ? ` - ${input.clientName.trim()}` : ''
  return `${date} Executed - ${label}${who}.${extension}`.replace(/[\\/:*?"<>|]+/g, '_')
}

/**
 * What the reading says against what the document needed, in the words of
 * the record's own validation. Advisory: the attorney confirms the record.
 */
export function readingAgainstRequirement(reading: ScanReading): string[] {
  const notes: string[] = []
  if (!reading.kind) {
    notes.push('The document kind could not be read; choose it before recording.')
    return notes
  }
  const requirement = requirementsFor(reading.kind)
  const label = documentLabel(reading.kind)
  if (!reading.signedOn) notes.push(`${label}: no signing date could be read.`)
  if (reading.witnessCount < requirement.witnesses) {
    notes.push(`${label} needs ${requirement.witnesses} witnesses; ${reading.witnessCount} signed on the scan.`)
  }
  if (requirement.notary === 'required' && !reading.notarized) {
    notes.push(`${label} must be acknowledged before a notary; no completed acknowledgment was read.`)
  }
  if (requirement.selfProving && !reading.selfProvingAffidavit) {
    notes.push(`${label}: the self-proving affidavit does not appear complete.`)
  }
  if (reading.confidence < 0.6) notes.push('Low confidence reading; check the scan before recording.')
  return [...notes, ...reading.issues]
}

/** One line for a card. */
export function summariseReading(reading: ScanReading): string {
  const label = reading.kind ? documentLabel(reading.kind) : 'Unidentified document'
  const parts = [label, reading.signedOn ? `signed ${reading.signedOn}` : 'date not read']
  if (reading.witnessCount > 0) parts.push(`${reading.witnessCount} witness${reading.witnessCount === 1 ? '' : 'es'}`)
  parts.push(reading.notarized ? 'notarised' : 'not notarised')
  return parts.join(', ')
}
