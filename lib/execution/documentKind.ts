import { detectDocumentKind } from '@/lib/execution/detect'
import { DOCUMENT_KINDS, type DocumentKind } from '@/lib/execution/requirements'

/**
 * What a generated document is, known at generation time.
 *
 * The generator renders a template with a fixed name, so the kind can be
 * recorded with the row rather than guessed from a filename afterwards. The
 * table below is the generator's template catalogue (tools/aubreylaw-docgeneration/templates)
 * read against the execution kinds; a template that is not an instrument
 * anyone signs at the table is `other`, so the signing view leaves it out.
 */
export type StoredDocumentKind = DocumentKind | 'other'

const SLUG_KINDS: Record<string, StoredDocumentKind> = {
  // Wills
  'will': 'will',
  'will-cp': 'will',
  'pourover-will': 'will',
  'testamentary-trust-will': 'will',
  // Trusts
  'revocable-trust': 'trust',
  'joint-trust': 'trust',
  'joint-trust-simplified': 'trust',
  'indv-disclaimer-trust': 'trust',
  'trust-individual-single': 'trust',
  'nominee-trust': 'trust',
  'real-estate-trust': 'trust',
  // Powers of attorney
  'durable-power-of-attorney': 'dpoa',
  'college-financial-poa': 'dpoa',
  'college-education-poa': 'dpoa',
  // Health care
  'health-care-proxy': 'health_care_proxy',
  'college-health-care-proxy': 'health_care_proxy',
  'hipaa-authorization': 'hipaa_authorization',
  'college-hipaa-authorization': 'hipaa_authorization',
  'health-care-directive': 'advance_directive',
  'living-will': 'advance_directive',
  'college-advance-directive': 'advance_directive',
  // Real estate
  'deed': 'deed',
  'deed-landcourt': 'deed',
  'homestead-trustee': 'homestead_declaration',
  // Trust ancillaries
  'certificate-of-trust': 'certificate_of_trust',
  'trustees-certificate': 'certificate_of_trust',
  'assignment-of-personal-property': 'assignment_of_personal_property',
  'personal-property-memorandum': 'personal_property_memorandum',
  // Children
  'parental-guardian-appointment': 'parental_guardian_appointment',
  // Not signed at the table
  'ancillary-execution': 'other',
  'design-summary-detailed': 'other',
  'design-summary-worksheet': 'other',
  'design-summary-worksheet-separate': 'other',
  'estate-plan-summary': 'other',
  'funding-instructions': 'other',
  'trust-funding-plan': 'other',
  'ferpa-release': 'other',
  'temporary-delegation-parental-powers': 'other',
  'young-adult-estate-plan': 'other',
}

function slugOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/^.*[\\/]/, '')
    .replace(/\.docx$/i, '')
    .replace(/^\d+[-_]?/, '')
    .replace(/_/g, '-')
    .trim()
}

/** The kind for a generator output file or template name such as `pourover-will.docx`. Null when the slug is not in the catalogue. */
export function documentKindForOutputSlug(slug: string): StoredDocumentKind | null {
  return SLUG_KINDS[slugOf(slug)] ?? null
}

/**
 * The kind for a template-library id: `estate-<slug>` for the generator's
 * templates, a real-estate variant id for deeds. Unknown ids fall back to the
 * title, which is still the generator's own name for the document rather
 * than one a person typed.
 */
export function documentKindForTemplate(input: { templateId: string | null; title: string | null }): StoredDocumentKind | null {
  const id = input.templateId ?? ''
  if (id.startsWith('estate-')) {
    const fromSlug = documentKindForOutputSlug(id.slice('estate-'.length))
    if (fromSlug) return fromSlug
  }
  if (/deed/i.test(id)) return 'deed'
  if (/homestead/i.test(id)) return 'homestead_declaration'
  return input.title ? detectDocumentKind(input.title) : null
}

export function isStoredDocumentKind(value: unknown): value is StoredDocumentKind {
  return value === 'other' || (typeof value === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value))
}

export interface KindedDocument {
  name: string
  kind: StoredDocumentKind | null
}

/**
 * Which kinds a matter's current documents are, the stored kind first and the
 * filename guess only where none was recorded. A document recorded as `other`
 * is neither a kind nor unmatched: it is a document nobody signs.
 */
export function resolveDocumentKinds(documents: readonly KindedDocument[]): { kinds: DocumentKind[]; unmatched: string[] } {
  const kinds: DocumentKind[] = []
  const unmatched: string[] = []
  for (const document of documents) {
    const kind = document.kind ?? detectDocumentKind(document.name)
    if (kind === 'other') continue
    if (kind === null) unmatched.push(document.name)
    else if (!kinds.includes(kind)) kinds.push(kind)
  }
  return { kinds, unmatched }
}
