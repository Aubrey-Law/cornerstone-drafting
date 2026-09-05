import type { DocumentKind } from './requirements'

/**
 * Guessing what a document is from its filename.
 *
 * A guess, and treated as one: the screen shows what was found for the attorney
 * to confirm or change. About a third of the documents in the live table do not
 * classify at all, which is the honest reason this is a starting point rather
 * than the source of truth. `matter_documents` records no document type, only a
 * name someone chose.
 *
 * Order is the whole design here. Every specific phrase must be tested before
 * the generic word it contains, or a certificate of trust reads as a trust, a
 * pour-over will reads as a trust, and a living will reads as a will — three
 * documents with three different sets of requirements.
 */
const PATTERNS: Array<[RegExp, DocumentKind]> = [
  [/certificate\s+of\s+trust/, 'certificate_of_trust'],
  [/health\s*care\s+proxy|healthcare\s+proxy|\bproxy\b/, 'health_care_proxy'],
  [/hipaa/, 'hipaa_authorization'],
  [/living\s+will|advance\s+(health\s*care\s+)?directive|health\s*care\s+directive/, 'advance_directive'],
  [/assignment\s+of\s+personal\s+property/, 'assignment_of_personal_property'],
  [/personal\s+property\s+memorandum/, 'personal_property_memorandum'],
  [/homestead/, 'homestead_declaration'],
  [/quitclaim|\bdeed\b/, 'deed'],
  [/power\s+of\s+attorney|\bdpoa\b|\bpoa\b/, 'dpoa'],
  [/guardian/, 'parental_guardian_appointment'],
  [/\bwill\b|testament/, 'will'],
  [/\btrust\b/, 'trust'],
]

export function detectDocumentKind(filename: string): DocumentKind | null {
  const name = filename.toLowerCase().replace(/[_\-.]+/g, ' ')
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(name)) return kind
  }
  return null
}

export function detectKinds(filenames: readonly string[]): {
  kinds: DocumentKind[]
  unmatched: string[]
} {
  const kinds: DocumentKind[] = []
  const unmatched: string[] = []
  for (const filename of filenames) {
    const kind = detectDocumentKind(filename)
    if (kind === null) unmatched.push(filename)
    else if (!kinds.includes(kind)) kinds.push(kind)
  }
  return { kinds, unmatched }
}
