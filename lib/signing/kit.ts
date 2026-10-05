import { ceremonyPlan, documentLabel, requirementsFor, type DocumentKind, type ExecutionRequirement } from '@/lib/execution/requirements'

/**
 * The signing-day kit: everything the room needs on paper before the client
 * sits down. Who must be present, which document is signed in which order,
 * where the tabs go, what the witnesses and the notary are told, and what
 * happens the moment the pens go down.
 *
 * Built from the execution rules the firm already encodes (one citation per
 * rule) and the plan's own answers, so the kit never says anything the
 * checklist would not. Pure, so the table of what each plan needs is a test.
 */

export interface SigningKitPerson {
  role: string
  name: string | null
  note: string | null
}

export interface SigningKitTab {
  /** Who signs at this tab, as printed on the flag. */
  label: string
  /** Where on the document: a signature line, an acknowledgment, an affidavit. */
  where: string
}

export interface SigningKitDocument {
  kind: DocumentKind
  label: string
  order: number
  signers: string[]
  witnesses: number
  notary: ExecutionRequirement['notary']
  notaryLabel: string
  selfProving: boolean
  recording: string | null
  tabs: SigningKitTab[]
  notes: string[]
  citation: string
}

export interface SigningDayKit {
  matterName: string
  clients: string[]
  scheduledFor: string | null
  location: string | null
  preparedOn: string
  /** Everyone who has to be in the room, in the order they are seated. */
  present: SigningKitPerson[]
  witnessesNeeded: number
  notaryRequired: boolean
  notaryReasons: string[]
  disqualifiedWitnesses: string[]
  documents: SigningKitDocument[]
  unmatchedDocuments: string[]
  bring: string[]
  witnessInstructions: string[]
  notaryInstructions: string[]
  afterSigning: string[]
  recordings: string[]
}

export interface SigningDayKitInput {
  matterName: string
  clients: string[]
  kinds: readonly DocumentKind[]
  unmatchedDocuments?: readonly string[]
  scheduledFor?: string | null
  location?: string | null
  notaryName?: string | null
  witnessNames?: readonly (string | null)[]
  healthCareAgentName?: string | null
  signingCity?: string | null
  now?: Date
}

const NOTARY_LABELS: Record<ExecutionRequirement['notary'], string> = {
  required: 'Required',
  required_in_practice: 'Required in practice',
  recommended: 'Recommended',
  not_required: 'Not needed',
}

function signerName(role: string, clients: string[]): string {
  // The plan's own names where there is one client; the role alone where
  // the same instrument is signed by each spouse in turn.
  if (clients.length === 1) return `${clients[0]} (${role.toLowerCase()})`
  return role
}

function tabsFor(requirement: ExecutionRequirement, clients: string[]): SigningKitTab[] {
  const tabs: SigningKitTab[] = requirement.signers.map(role => ({
    label: `Sign: ${signerName(role, clients)}`,
    where: requirement.kind === 'trust' && role === 'Trustee'
      ? 'Trustee acceptance line'
      : 'Signature line',
  }))
  for (let index = 1; index <= requirement.witnesses; index += 1) {
    tabs.push({ label: `Witness ${index}`, where: 'Witness attestation' })
  }
  if (requirement.selfProving) {
    tabs.push({ label: 'Self-proving affidavit: testator, both witnesses, notary', where: 'Affidavit following the attestation' })
  } else if (requirement.notary !== 'not_required') {
    tabs.push({ label: 'Notary acknowledgment', where: 'Acknowledgment block' })
  }
  return tabs
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  })
}

export function buildSigningDayKit(input: SigningDayKitInput): SigningDayKit {
  const clients = input.clients.map(name => name.trim()).filter(Boolean)
  const plan = ceremonyPlan(input.kinds)
  const documents: SigningKitDocument[] = plan.documents.map((requirement, index) => ({
    kind: requirement.kind,
    label: documentLabel(requirement.kind),
    order: index + 1,
    signers: requirement.signers,
    witnesses: requirement.witnesses,
    notary: requirement.notary,
    notaryLabel: NOTARY_LABELS[requirement.notary],
    selfProving: requirement.selfProving,
    recording: requirement.recording,
    tabs: tabsFor(requirement, clients),
    notes: requirement.notes,
    citation: requirement.citation,
  }))

  const witnessNames = input.witnessNames ?? []
  const present: SigningKitPerson[] = clients.length
    ? clients.map(name => ({ role: 'Client', name, note: 'Brings a government photo ID for the notary.' }))
    : [{ role: 'Client', name: null, note: 'Brings a government photo ID for the notary.' }]
  for (let index = 1; index <= plan.witnessesNeeded; index += 1) {
    present.push({
      role: `Witness ${index}`,
      name: witnessNames[index - 1] ?? null,
      note: 'At least 18, not named anywhere in the plan, not related to anyone who is.',
    })
  }
  if (plan.notaryRequired) {
    present.push({
      role: 'Notary public',
      name: input.notaryName ?? null,
      note: 'A separate person from both witnesses. Brings stamp and journal.',
    })
  }
  const hasProxy = input.kinds.includes('health_care_proxy')

  const witnessInstructions = plan.witnessesNeeded > 0
    ? [
        'Stay in the room from the first signature to the last. Each witness must see the client sign, or hear the client acknowledge the signature as their own, before signing the attestation.',
        'Be at least 18 years old, and not be named in any document being signed today: not a beneficiary, fiduciary or agent, and not the spouse or partner of anyone who is.',
        hasProxy
          ? `The health care agent${input.healthCareAgentName ? ` (${input.healthCareAgentName})` : ''} and the alternate agent may not witness the health care proxy. This is the rule most often broken at the table and it goes to validity (G.L. c. 201D, § 2).`
          : null,
        'Sign in blue ink on the witness lines where the tabs are placed, and print your name beneath your signature where the form asks.',
        'For the self-proving affidavit on a will, both witnesses swear before the notary after signing the attestation, so stay until the notary has finished.',
      ].filter((line): line is string => Boolean(line))
    : ['No document being signed today requires witnesses.']

  const notaryInstructions = plan.notaryRequired
    ? [
        'Check each signer’s government photo ID before anything is signed, and record the acknowledgment in the journal.',
        'Acknowledgments (trust, power of attorney, deed, homestead declaration, certificate of trust): the signer acknowledges the signature as a free act; witnesses are not part of the acknowledgment.',
        input.kinds.includes('will')
          ? 'Self-proving affidavit on the will (G.L. c. 190B, § 2-504): the testator and both witnesses swear before you after the attestation is signed. All three sign the affidavit; complete the jurat.'
          : null,
        input.kinds.includes('deed') || input.kinds.includes('homestead_declaration')
          ? 'Deeds and homestead declarations go to the Registry of Deeds: the acknowledgment must be complete and legible, with the county and date, or the Registry will reject it.'
          : null,
        `Venue: ${input.signingCity ? `${input.signingCity}, ` : ''}Massachusetts. Date every acknowledgment with the signing date and confirm the commission has not expired.`,
      ].filter((line): line is string => Boolean(line))
    : ['No document being signed today needs a notary.']

  const afterSigning = [
    'Check every document before anyone leaves: each signature, each witness line, each acknowledgment and affidavit signed and dated with today’s date.',
    'Record the appointment on the matter’s Signing view: who witnessed, who notarised, and which documents were executed.',
    'Scan the executed originals into the matter the same day and note where the originals are kept.',
    ...plan.recordings.map(recording => `Record at the Registry: ${recording}.`),
    input.kinds.includes('certificate_of_trust')
      ? 'Give the client certified copies of the certificate of trust for the bank and brokerage; the trust itself stays in the file.'
      : null,
    input.kinds.includes('trust')
      ? 'Start funding: deeds, account retitling and beneficiary designations follow the signing, and the trust protects nothing until they do.'
      : null,
  ].filter((line): line is string => Boolean(line))

  return {
    matterName: input.matterName,
    clients,
    scheduledFor: formatWhen(input.scheduledFor),
    location: input.location ?? null,
    preparedOn: (input.now ?? new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }),
    present,
    witnessesNeeded: plan.witnessesNeeded,
    notaryRequired: plan.notaryRequired,
    notaryReasons: plan.notaryReasons,
    disqualifiedWitnesses: plan.disqualifiedWitnesses,
    documents,
    unmatchedDocuments: [...(input.unmatchedDocuments ?? [])],
    bring: [
      'The full set of originals, one per document, dated for the signing day and tabbed as listed below.',
      'Blue ink pens for every signer, witness and the notary.',
      plan.notaryRequired ? 'The notary’s stamp and journal.' : null,
      'A copy of this kit for the table, and the Signing view open to record the appointment.',
    ].filter((line): line is string => Boolean(line)),
    witnessInstructions,
    notaryInstructions,
    afterSigning,
    recordings: plan.recordings,
  }
}

/** One line for a card or a task: what the appointment needs. */
export function summariseSigningKit(kit: Pick<SigningDayKit, 'documents' | 'witnessesNeeded' | 'notaryRequired'>): string {
  const count = kit.documents.length
  const parts = [`${count} document${count === 1 ? '' : 's'} to sign`]
  if (kit.witnessesNeeded > 0) parts.push(`${kit.witnessesNeeded} witnesses`)
  parts.push(kit.notaryRequired ? 'a notary' : 'no notary')
  return parts.join(', ')
}

/** The requirement a card can show for one kind, for callers that have no kit built. */
export function requirementSummary(kind: DocumentKind): string {
  const requirement = requirementsFor(kind)
  return `${documentLabel(kind)}: ${requirement.witnesses} witness${requirement.witnesses === 1 ? '' : 'es'}, notary ${NOTARY_LABELS[requirement.notary].toLowerCase()}`
}
