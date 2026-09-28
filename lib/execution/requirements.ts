/**
 * What Massachusetts requires to execute each document, as the firm has
 * encoded it.
 *
 * This is the highest-consequence checklist in the practice and it normally
 * lives in one person's memory: how many witnesses, whether the notary has to
 * be there, who is disqualified from signing, what gets recorded afterwards. A
 * signing that goes wrong is discovered years later, by someone who cannot fix
 * it.
 *
 * Every rule carries its citation. A checklist an attorney cannot verify is a
 * checklist they must simply trust, and this one is meant to be read against
 * the statute and corrected when the statute moves.
 *
 * Pure, so the rules are a table in a test rather than something asserted
 * through a screen.
 */

export const DOCUMENT_KINDS = [
  'will',
  'trust',
  'dpoa',
  'health_care_proxy',
  'hipaa_authorization',
  'advance_directive',
  'deed',
  'homestead_declaration',
  'certificate_of_trust',
  'assignment_of_personal_property',
  'personal_property_memorandum',
  'parental_guardian_appointment',
] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

/**
 * `required` is the statute's demand. `required_in_practice` is not — it marks
 * a document that is valid without a notary and that no bank, brokerage or
 * registry will accept unnotarised, so it is never actually signed that way.
 * Keeping the two apart means the checklist does not misquote the law.
 */
export type NotaryRequirement = 'required' | 'required_in_practice' | 'recommended' | 'not_required'

export interface ExecutionRequirement {
  kind: DocumentKind
  signers: string[]
  witnesses: number
  notary: NotaryRequirement
  /** A will may be made self-proving; that is what its notary is for. */
  selfProving: boolean
  /** Where it must be recorded, when signing alone does not finish the job. */
  recording: string | null
  disqualifiedWitnesses: string[]
  citation: string
  notes: string[]
}

const LABELS: Record<DocumentKind, string> = {
  will: 'Will',
  trust: 'Revocable trust',
  dpoa: 'Durable power of attorney',
  health_care_proxy: 'Health care proxy',
  hipaa_authorization: 'HIPAA authorization',
  advance_directive: 'Advance directive',
  deed: 'Deed',
  homestead_declaration: 'Declaration of homestead',
  certificate_of_trust: 'Certificate of trust',
  assignment_of_personal_property: 'Assignment of personal property',
  personal_property_memorandum: 'Personal property memorandum',
  parental_guardian_appointment: 'Appointment of guardian for a minor',
}

export function documentLabel(kind: DocumentKind): string {
  return LABELS[kind] ?? kind
}

const REQUIREMENTS: Record<DocumentKind, Omit<ExecutionRequirement, 'kind'>> = {
  will: {
    signers: ['Testator'],
    witnesses: 2,
    notary: 'recommended',
    selfProving: true,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 190B, § 2-502; self-proving affidavit § 2-504',
    notes: [
      'Both witnesses must sign within a reasonable time after witnessing the signing, or after the testator acknowledges the signature as their own.',
      'A notary is not required for the will to be valid. It is required for the self-proving affidavit, which lets the will be allowed later without finding a witness again.',
      'Under the MUPC an interested witness no longer voids the gift (§ 2-505), but a disinterested witness removes the argument entirely.',
    ],
  },
  trust: {
    signers: ['Settlor', 'Trustee'],
    witnesses: 0,
    notary: 'required_in_practice',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 203E (Massachusetts Uniform Trust Code)',
    notes: [
      'No witnesses are required. Notarisation is not a condition of validity either, but a bank, a brokerage or the Registry will refuse an unnotarised trust, so it is done every time.',
      'The trustee signs to accept the trusteeship — including where the settlor is the trustee.',
    ],
  },
  dpoa: {
    signers: ['Principal'],
    witnesses: 2,
    notary: 'required_in_practice',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 190B, Art. V, Pt. 5; acknowledgment for recording G.L. c. 183, § 29',
    notes: [
      'Massachusetts requires only a signed writing with durability language. Witnesses and a notary are the firm’s practice, because an institution that refuses the document makes it useless when it is needed.',
      'It must be acknowledged before a notary if it will ever be used for real estate, since the Registry will not accept it otherwise.',
    ],
  },
  health_care_proxy: {
    signers: ['Principal'],
    witnesses: 2,
    notary: 'not_required',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: ['The health care agent', 'The alternate health care agent'],
    citation: 'G.L. c. 201D, § 2',
    notes: [
      'The person appointed as agent may not witness the proxy. This is the rule most often broken at the table, and it goes to the document’s validity.',
      'The witnesses affirm the principal appeared to be at least 18, of sound mind, and under no constraint or undue influence.',
    ],
  },
  hipaa_authorization: {
    signers: ['Individual'],
    witnesses: 0,
    notary: 'not_required',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: '45 C.F.R. § 164.508',
    notes: ['Signed and dated by the individual. No witness or notary is required.'],
  },
  advance_directive: {
    signers: ['Principal'],
    witnesses: 2,
    notary: 'not_required',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'No Massachusetts living-will statute; executed by practice',
    notes: [
      'Massachusetts has no living-will statute, so this is evidence of the client’s wishes rather than a directive a provider must follow. It is witnessed like one because that is what gives it weight.',
      'The health care proxy is the document that actually appoints someone to decide.',
    ],
  },
  deed: {
    signers: ['Grantor'],
    witnesses: 0,
    notary: 'required',
    selfProving: false,
    recording: 'Registry of Deeds for the county where the land lies',
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 183, § 29',
    notes: [
      'The grantor’s signature must be acknowledged before a notary, or the Registry will not record it.',
      'A deed that is signed but not recorded leaves the property exposed to later creditors and purchasers — and does not finish funding the trust.',
    ],
  },
  homestead_declaration: {
    signers: ['Owner'],
    witnesses: 0,
    notary: 'required',
    selfProving: false,
    recording: 'Registry of Deeds for the county where the land lies',
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 188, § 5',
    notes: [
      'Recording is what creates the declared homestead. An unrecorded declaration protects nothing beyond the automatic homestead.',
    ],
  },
  certificate_of_trust: {
    signers: ['Trustee'],
    witnesses: 0,
    notary: 'required_in_practice',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 203E, § 1013',
    notes: [
      'This is what a bank is entitled to instead of the trust itself, so it is notarised to be accepted.',
    ],
  },
  assignment_of_personal_property: {
    signers: ['Settlor'],
    witnesses: 0,
    notary: 'recommended',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 203E; general contract principles',
    notes: ['Moves untitled personal property into the trust in one instrument.'],
  },
  personal_property_memorandum: {
    signers: ['Testator'],
    witnesses: 0,
    notary: 'not_required',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 190B, § 2-513',
    notes: [
      'The will must refer to it. Its point is that the client can change it afterwards without executing anything again — so it is deliberately not witnessed.',
    ],
  },
  parental_guardian_appointment: {
    signers: ['Parent'],
    witnesses: 2,
    notary: 'not_required',
    selfProving: false,
    recording: null,
    disqualifiedWitnesses: [],
    citation: 'G.L. c. 190B, § 5-202',
    notes: ['Both parents sign where both have custody.'],
  },
}

export function requirementsFor(kind: DocumentKind): ExecutionRequirement {
  return { kind, ...REQUIREMENTS[kind] }
}

export interface CeremonyPlan {
  documents: ExecutionRequirement[]
  /** The most any single document needs — the same people witness everything. */
  witnessesNeeded: number
  notaryRequired: boolean
  notaryReasons: string[]
  disqualifiedWitnesses: string[]
  recordings: string[]
  /** Kinds with no rule here, reported rather than silently dropped. */
  unknownKinds: string[]
}

const isKnown = (kind: string): kind is DocumentKind =>
  (DOCUMENT_KINDS as readonly string[]).includes(kind)

/**
 * What one signing appointment needs.
 *
 * Witnesses are the maximum any single document requires, not the sum: the same
 * two people sit through the whole appointment. Documents needing witnesses are
 * listed first, because they are signed while those people are still in the
 * room.
 */
export function ceremonyPlan(kinds: readonly string[]): CeremonyPlan {
  const unknownKinds = kinds.filter((kind) => !isKnown(kind))
  const documents = kinds.filter(isKnown).map(requirementsFor)

  const notaryReasons: string[] = []
  for (const doc of documents) {
    if (doc.notary === 'required') {
      notaryReasons.push(`${documentLabel(doc.kind)} must be notarised to be ${doc.recording ? 'recorded' : 'accepted'}.`)
    } else if (doc.notary === 'required_in_practice') {
      notaryReasons.push(`${documentLabel(doc.kind)} is notarised so institutions will accept it.`)
    } else if (doc.selfProving) {
      notaryReasons.push(`${documentLabel(doc.kind)} needs a notary for its self-proving affidavit.`)
    }
  }

  return {
    documents: [...documents].sort((a, b) => b.witnesses - a.witnesses),
    witnessesNeeded: documents.reduce((most, doc) => Math.max(most, doc.witnesses), 0),
    notaryRequired: notaryReasons.length > 0,
    notaryReasons,
    disqualifiedWitnesses: [...new Set(documents.flatMap((doc) => doc.disqualifiedWitnesses))],
    recordings: [
      ...new Set(documents.flatMap((doc) => (doc.recording ? [`${documentLabel(doc.kind)}: ${doc.recording}`] : []))),
    ],
    unknownKinds,
  }
}
