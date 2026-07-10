import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { logAiUsage } from '@/lib/aiUsage'
import { getAnthropicClient } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { parseDesignSheetImportText } from '@/lib/designSheetImport/server'
import { buildDraftPayload, type DraftPayload } from '@/lib/buildDraftPayload'
import { formatPhoneDisplay } from '@/lib/phone'
import { estateValueLabel } from '@aubrey-law/estate-fields'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { loadHouseholdChildren } from '@/lib/contacts/loadHouseholdChildren'
import { getFirmConfig } from '@/lib/firmConfig'
import { firmTodayKey } from '@/lib/firmDate'

export const maxDuration = 120

type ChatContextType = 'matter' | 'general'
type ChatRole = 'user' | 'assistant'

interface ChatRequest {
  messages: { role: ChatRole; content: string }[]
  context_type: ChatContextType
  context_id?: string
}

type Row = Record<string, unknown>


const DESIGN_SHEET_IMPORT_TOOL_NAME = 'propose_design_sheet_updates'

const CHAT_MATTER_COLUMNS =
  'id, client_intake_id, matter_number, stage, status, name' as const
const CHAT_PIPELINE_COLUMNS =
  'matter_id, practice_area, marital_status, client_dob, stage, status, matter_name, plan_type, has_minor_children' as const
// Select all columns: the chat reads many intake fields and a hand-maintained
// list drifts from the schema (e.g. `referral_source` does not exist on
// client_intake), which throws and drops the whole matter context. `select('*')`
// matches fetchIntakeForMatter and is resilient to schema drift.
const CHAT_INTAKE_COLUMNS = '*' as const
const CHAT_MATTER_NOTE_COLUMNS =
  'created_at, note_type, body' as const
const CHAT_MATTER_DETAILS_COLUMNS =
  'practice_area, legal_plan, legal_plan_id, legal_plan_type, legal_plan_service_start, legal_plan_service_end, ep_plan_category, plan_type' as const
const CHAT_DESIGN_SHEET_COLUMNS =
  'status, plan_type, trust_name, is_joint, client_name, spouse_name, children, assets, goals_notes, concerns, excluded_guardian_flag, excluded_guardian_name, trustee_slots, executor_slots, poa_slots, hcp_slots, guardian_slots, spouse_trustee_slots, spouse_executor_slots, spouse_poa_slots, spouse_hcp_slots' as const

function text(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  if (Array.isArray(value)) return value.length ? value.map(item => String(item)).join(', ') : fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function asRow(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}

function money(value: unknown) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '-'
  return `$${num.toLocaleString()}`
}

function fullName(row: Row | null | undefined) {
  if (!row) return '-'
  return text(
    row.full_name ??
    [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
  )
}

function summarizeAssets(
  intake: Row | null,
  designSheet: Row | null,
  assetIntakeRows: Row[] = [],
) {
  const financialDetails = asRow(intake?.financial_details)
  const detail = (key: string) => intake?.[key] ?? financialDetails?.[key]
  const parts = [
    `Estimated estate value: ${text(intake?.estate_value ?? detail('estimated_estate_value') ?? detail('taxable_estate'))}`,
    `Taxable estate: ${money(detail('taxable_estate'))}`,
    `Real property: ${text(detail('real_property_address'))} ${text(detail('real_property_value'), '')}`.trim(),
    `Retirement: ${text(detail('retirement_value'))}`,
    `Life insurance: ${text(detail('life_insurance_value'))}`,
    `Business: ${text(detail('business_description'))}`,
  ]

  if (assetIntakeRows.length > 0) {
    const total = assetIntakeRows.reduce((sum, row) => sum + (Number(row.value) || 0), 0)
    parts.push(`Recorded assets (${assetIntakeRows.length} items, total ${money(total)}):`)
    for (const row of assetIntakeRows.slice(0, 40)) {
      parts.push(
        `  - ${text(row.category)}: ${text(row.description)} — ${money(row.value)} (${text(row.ownership)})`,
      )
    }
    if (assetIntakeRows.length > 40) {
      parts.push(`  - … and ${assetIntakeRows.length - 40} more asset rows`)
    }
  }

  if (designSheet?.assets) {
    parts.push(`Design-sheet assets: ${text(designSheet.assets)}`)
  }

  return parts.filter(part => !part.endsWith('-') && !part.endsWith(':')).join('\n')
}

function summarizeFamily(intake: Row | null, matter: Row | null) {
  const children = Array.isArray(intake?.children) ? intake.children : null
  return [
    `Marital status: ${text(intake?.marital_status ?? matter?.marital_status)}`,
    `Spouse: ${text(intake?.spouse_name ?? [intake?.spouse_first_name, intake?.spouse_last_name].filter(Boolean).join(' '))}`,
    `Children count: ${children ? children.length : '-'}`,
    `Children: ${formatChildrenList(children)}`,
    `Minor children: ${text(intake?.has_minor_children ?? matter?.has_minor_children)}`,
  ].join('\n')
}

function summarizeFiduciaries(intake: Row | null, designSheet: Row | null) {
  return [
    `Trustee: ${text(intake?.trustee_primary ?? designSheet?.trustee_slots)}`,
    `Executor: ${text(intake?.executor_primary ?? designSheet?.executor_slots)}`,
    `POA: ${text(intake?.poa_primary ?? designSheet?.poa_slots)}`,
    `Healthcare proxy: ${text(intake?.hcp_primary ?? designSheet?.hcp_slots)}`,
    `Guardian: ${text(intake?.guardian_primary ?? designSheet?.guardian_slots)}`,
  ].join('\n')
}

function formatChildrenList(children: unknown): string {
  if (!Array.isArray(children) || children.length === 0) return '-'
  return children.map((child) => {
    const row = asRow(child)
    if (!row) return String(child)
    const name =
      text(row.name ?? [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '))
    const dob = row.dob ?? row.date_of_birth
    const minor = row.is_minor === true ? 'minor' : row.is_minor === false ? 'adult' : null
    const details = [
      dob ? `DOB ${text(dob)}` : null,
      minor,
      row.relationship ? text(row.relationship) : null,
      row.parentage ? `child of ${text(row.parentage)}` : null,
    ].filter(Boolean).join(', ')
    return details ? `${name} (${details})` : name
  }).join('; ')
}

function planningGoalsText(intake: Row | null): string {
  const planningGoals = intake?.planning_goals
  if (Array.isArray(planningGoals) && planningGoals.length > 0) {
    return planningGoals.map(String).join(', ')
  }
  return text(intake?.goals_notes ?? intake?.goals ?? intake?.planning_objectives)
}

function formatIntakeQuestionnaire(intake: Row | null, pipeline?: Row | null): string {
  if (!intake) return 'INTAKE QUESTIONNAIRE: not available'
  const address = [intake.address_line1, intake.city, intake.state, intake.zip]
    .filter(Boolean)
    .join(', ')
  const spouse = intake.spouse_name ?? [intake.spouse_first_name, intake.spouse_last_name]
    .filter(Boolean)
    .join(' ')
  return `INTAKE QUESTIONNAIRE:
- Status: ${text(intake.status)}
- Client: ${fullName(intake)}; DOB ${text(intake.date_of_birth ?? pipeline?.client_dob)}; pronouns ${text(intake.preferred_pronoun)}
- Contact: ${text(intake.email)}; ${text(formatPhoneDisplay(intake.phone as string | null | undefined))}
- Address: ${text(address)}; County ${text(intake.county)}
- Marital status: ${text(intake.marital_status ?? pipeline?.marital_status)}; marriage date ${text(intake.date_of_marriage)}
- Spouse: ${text(spouse)}; DOB ${text(intake.spouse_date_of_birth)}; ${text(intake.spouse_email)}; ${text(formatPhoneDisplay(intake.spouse_phone as string | null | undefined))}
- Children: ${formatChildrenList(intake.children)}
- Minor children: ${text(intake.has_minor_children ?? pipeline?.has_minor_children)}
- Estate value: ${text(estateValueLabel(intake.estate_value) ?? intake.estate_value)}
- Planning goals: ${planningGoalsText(intake)}
- Financial details: ${text(intake.financial_details)}
- Excluded guardians: ${text(intake.excluded_guardian ?? intake.excluded_guardian_2)}
- Special notes: ${text(intake.special_notes ?? intake.special_circumstances)}
- Attorney review flags: ${text(intake.attorney_review_flags)}`
}

function formatDesignSheetSummary(designSheet: Row | null): string {
  if (!designSheet) return 'DESIGN SHEET SUMMARY: not available'
  return `DESIGN SHEET SUMMARY:
- Status: ${text(designSheet.status)}
- Plan type: ${text(designSheet.plan_type)}; joint trust: ${text(designSheet.is_joint)}
- Client: ${text(designSheet.client_name)}; spouse: ${text(designSheet.spouse_name)}
- Trust name: ${text(designSheet.trust_name)}
- Children: ${formatChildrenList(designSheet.children)}
- Assets: ${text(designSheet.assets)}
- Goals notes: ${text(designSheet.goals_notes)}
- Concerns: ${text(designSheet.concerns)}
- Excluded guardians: ${designSheet.excluded_guardian_flag ? text(designSheet.excluded_guardian_name) : '-'}
- Trustee slots: ${text(designSheet.trustee_slots)}
- Personal representative slots: ${text(designSheet.executor_slots)}
- POA slots: ${text(designSheet.poa_slots)}
- HCP slots: ${text(designSheet.hcp_slots)}
- Guardian slots: ${text(designSheet.guardian_slots)}
- Spouse trustee slots: ${text(designSheet.spouse_trustee_slots)}
- Spouse PR slots: ${text(designSheet.spouse_executor_slots)}
- Spouse POA slots: ${text(designSheet.spouse_poa_slots)}
- Spouse HCP slots: ${text(designSheet.spouse_hcp_slots)}`
}

function draftingSkillSummaryInstructions() {
  return `\n\nDESIGN SHEET DRAFTING SUMMARY: If Scott asks to summarize the design sheet for Claude, for a Claude skill, for drafting, or for document generation, produce a self-contained prompt under the heading "Claude Drafting Skill Input".

Use this exact structure:
1. Role and task: tell Claude it is drafting Massachusetts estate-planning documents for Aubrey Law from attorney-approved design-sheet facts.
2. Non-invention rule: instruct Claude to use only provided facts, mark unknowns as [UNKNOWN], and preserve attorney review flags.
3. Matter snapshot: client, spouse, marital status, plan type, trust type, minor children, signing details, and jurisdiction.
4. Documents to draft: list only selected/included documents from the normalized drafting payload.
5. People and fiduciaries: client, spouse, children if present, personal representative, trustee, DPOA agents, health care agents, guardians, and alternates.
6. Document provisions: trust/will distribution, tax planning, will provisions, DPOA provisions, HCP/HIPAA provisions, special provisions, and ancillary documents.
7. Missing or attorney-review items: any null, blank, unclear, internally inconsistent, or high-risk choices.
8. Output requirements: ask Claude for clean draft-ready instructions, not client advice, and to keep Massachusetts-specific drafting assumptions explicit.

Do not invent names, dates, relationships, assets, tax conclusions, or fiduciary roles that are not present in the matter context or normalized drafting payload. If a value is absent, write [UNKNOWN].`
}

function isDraftingSummaryRequest(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('design sheet') &&
    normalized.includes('draft') &&
    (normalized.includes('claude') || normalized.includes('skill') || normalized.includes('document'))
}

function trustDraftingIntakeInstructions() {
  return `\n\nTRUST DRAFTING INTAKE: If Scott asks to gather trust details, collect trust drafting info, prep a trust intake, or set up the inputs for a revocable trust, run a structured two-pass interview to gather everything needed to draft a Massachusetts revocable living trust + pour-over will package.

How to run it:
- Work from any client/matter context already shown above first. Pre-fill every item you can already answer from that context, and ONLY ask Scott for items that are missing, blank, or ambiguous. Never re-ask for facts already shown above. If no context is loaded, ask for each item.
- Ask in short batches (3-5 questions at a time), Pass 1 before Pass 2. Number the questions so Scott can answer inline.
- Do not invent names, dates, relationships, or counties. If Scott says a value is unknown, record it as [UNKNOWN]. For an undecided execution date, record the blank date line exactly as: \`___________________, 20___\`.
- When done, echo back a clean, labeled recap of all collected values (Pass 1 then Pass 2) for Scott to confirm. After he confirms, emit the trust-drafting skill handoff block described at the end so it can be pasted straight into the trust-drafting skill.

PASS 1 — always confirm or collect:
1. Trust type: Individual Revocable Trust OR Joint Revocable Trust.
2. Client full legal name (free text). If joint, collect BOTH client and spouse full legal names.
3. Client address, city, and county (free text). County must be a Massachusetts county (needed for notary blocks) — flag if it is not.
4. Trust name (e.g. "The John A. Smith Revocable Trust"; joint: "The John A. and Jane B. Smith Revocable Trust").
5. Trust execution date (free text, or "TBD"). If TBD, leave the blank date line \`___________________, 20___\`.
6. Children: names, and whether each is a minor or adult. If none, record "No children". If any minors, also collect each minor's date of birth.
7. Successor trustee(s): name and relationship — primary successor, then alternate. For a joint trust the surviving spouse is typically first, then the named successor.
8. Personal representative / executor for the pour-over will: primary (and co-primary if any); successor (and co-successor if any).

PASS 2 — only ask if the answer is NOT already in the matter context:
9. Initial co-trustee? Yes/No. If yes, full name and relationship.
10. Guardian(s) — ONLY if minor children exist: primary guardian name; successor guardian name; second successor guardian name; any excluded guardians (name and reason).
11. Signing county (for notary blocks). Default to Norfolk County (Needham office) unless Scott says the client is signing elsewhere.
12. Asset profile (used to suppress checklist rows) — ask Yes/No for each: out-of-state real estate; business interests; stock options / RSUs; oil/gas/mineral rights; 529 plans.

SKILL HANDOFF — after Scott confirms the recap, emit this block verbatim (fenced, exact header and field labels) so it can be pasted directly into the trust-drafting skill. Fill every value; use [UNKNOWN] where not provided; omit the Spouse and joint-only lines for an individual trust.
\`\`\`
=== TRUST DRAFTING SKILL INPUT ===
Matter type: <Individual | Joint>
Trust type: <Individual Revocable Trust | Joint Revocable Trust>
Client full legal name: <name>
Client address: <street>, <city>, <county> County, <state>
Spouse full legal name: <name | n/a>
Spouse address: <street, city, county, state | same as client | n/a>
Trust name: <e.g. The John A. Smith Revocable Trust>
Trust execution date: <YYYY-MM-DD | TBD -> ___________________, 20___>
Children: <Name (adult/minor; DOB if minor); ... | No children>
Initial co-trustee: <name, relationship | None>
Successor trustees (in order): 1) <name, relationship> 2) <name, relationship>
Pour-over will personal representative(s): primary <name(s)>; successor <name(s)>
Guardian(s) (only if minor children): primary <name>; successor <name>; second successor <name>; excluded <name, reason | none>
Signing county: <MA county>
Asset profile: out-of-state real estate <Y/N>; business interests <Y/N>; stock options/RSUs <Y/N>; oil/gas/mineral rights <Y/N>; 529 plans <Y/N>
Special instructions: <notes | none>
=== END ===
\`\`\``
}

function incapacityDesignSheetInstructions() {
  const today = firmTodayKey()
  return `\n\nINCAPACITY DESIGN SHEET: If Scott asks to create an incapacity design sheet, gather incapacity details, prep the incapacity/DPOA/HCP/HIPAA inputs, or set up an Advance Health Directive package, run a structured interview to gather everything needed and then produce a completed design sheet.

This package produces 5 documents PER CLIENT (10 for a married couple):
- Advance Health Directive (Living Will)
- Health Care Proxy
- HCP Preferences Worksheet (companion to the HCP — not legally binding)
- HIPAA Authorization
- Durable Power of Attorney

How to run it:
- Work from any client/matter context already shown above first. Pre-fill every item you can already answer from that context, and ONLY ask Scott for items that are missing, blank, or ambiguous. Never re-ask for facts already shown above. If no context is loaded, ask for each item.
- Ask in short numbered batches (Matter Information first, then Client 1, then Client 2 only if a married couple). Number the questions so Scott can answer inline.
- Do not invent names, dates, relationships, counties, or addresses. If Scott says a value is unknown, record it as [UNKNOWN].
- Apply these defaults unless Scott overrides: drafting date = today (${today}); signing county = Client 1's county of residence; state = Massachusetts; co-agent authority mode = Separate (each may act alone). Gifting is hardcoded OFF in the DPOA template — there is no override; do not offer one.
- Constraint to enforce and flag: DPOA witnesses must NOT be the Attorney-in-Fact or any successor.

Collect — Section 1, Matter Information:
- Matter name / file reference (used as the OUTPUTS subfolder name, e.g. Smith_Jane_and_John)
- Matter type: Individual (5 docs) OR Married couple (10 docs)
- Drafting date (YYYY-MM-DD; defaults to today ${today}; sets the filename prefix)
- Scheduled signing date (YYYY-MM-DD, or "unscheduled" — unscheduled leaves the execution date blanks underscored)
- Signing county (defaults to Client 1's county of residence)

Collect — Section 2, Client 1 Personal Information:
- Full legal name (exactly as it should appear on the documents)
- Date of birth (e.g. January 15, 1962 — used in HIPAA only)
- Street address (number, street); City; County of residence (defaults to signing county); State (default Massachusetts)
- Subject pronoun (he | she); Possessive pronoun (his | her)

Client 1 — Health Care Proxy fiduciaries:
- Primary Health Care Agent: full legal name; relationship to client; full mailing address (street, city, state, ZIP); phone
- Alternate Health Care Agent: full legal name; relationship; full mailing address; phone

Client 1 — Durable Power of Attorney fiduciaries:
- Initial Attorney-in-Fact: full legal name; is the AIF married? (Yes triggers the AIF-spouse clause in Self-Dealing | No)
- Co-Attorney-in-Fact (optional): use a co-agent? (No — skip the rest | Yes). If Yes: co-agent full legal name; authority mode (Separate = each may act alone, DEFAULT | Joint = both must sign); is the co-agent married? (Yes | No)
- Successor Attorneys-in-Fact, in order (add or remove as needed): 1, 2, 3

Client 1 — Special Instructions / Drafting Notes (optional): anything Scott should know — limits on agent authority, non-default choices, trust beneficiary disclosures for HIPAA recipient documentation, etc. Leave blank if none.

Section 3, Client 2 — ONLY if Matter type is "Married couple" (if Individual, skip Section 3 entirely). Collect the same fields as Client 1: Personal Information (full legal name; DOB for HIPAA; address/city/county/state; subject + possessive pronouns); Health Care Proxy fiduciaries (primary + alternate agent: name, relationship, mailing address, phone); Durable Power of Attorney fiduciaries (initial AIF + married?; optional co-agent with authority mode + married?; successors 1-3); Special Instructions / Drafting Notes (optional).

When done — produce TWO things for Scott to confirm before drafting:
1. A clean, labeled recap of the design sheet, organized by Section (1 Matter Information, 2 Client 1, 3 Client 2 if applicable), with all defaults resolved to concrete values.
2. The exact list of output filenames, one set of 5 per client, using the drafting date as the YYYY-MM-DD prefix and the client's full legal name verbatim (spaces fine, no abbreviations, initials, or version suffixes). Document titles are lowercase exactly as shown:
   YYYY-MM-DD_advance health directive_{Client Full Legal Name}.docx
   YYYY-MM-DD_health care proxy_{Client Full Legal Name}.docx
   YYYY-MM-DD_hcp preferences worksheet_{Client Full Legal Name}.docx
   YYYY-MM-DD_hipaa_{Client Full Legal Name}.docx
   YYYY-MM-DD_durable poa_{Client Full Legal Name}.docx

SKILL HANDOFF — after Scott confirms the recap, emit this block verbatim (fenced, exact header and field labels) so it can be pasted directly into the incapacity-drafting skill. Resolve every default to a concrete value; use [UNKNOWN] where not provided; repeat the CLIENT block once per client and omit CLIENT 2 for an individual matter.
\`\`\`
=== INCAPACITY DRAFTING SKILL INPUT ===
Matter name / file reference (OUTPUTS subfolder): <e.g. Smith_Jane_and_John>
Matter type: <Individual | Married couple>
Drafting date (filename prefix): <YYYY-MM-DD>
Scheduled signing date: <YYYY-MM-DD | unscheduled>
Signing county: <MA county>

[CLIENT 1]
Full legal name: <name>
Date of birth: <Month D, YYYY>
Street address: <number, street>
City: <city>
County of residence: <county>
State: <state>
Subject pronoun: <he | she>
Possessive pronoun: <his | her>
HCP primary agent: <name | relationship | street, city, state ZIP | phone>
HCP alternate agent: <name | relationship | street, city, state ZIP | phone>
DPOA initial attorney-in-fact: <name> (married: <Yes | No>)
DPOA co-agent: <None | name, authority <Separate | Joint>, married <Yes | No>>
DPOA successors (in order): 1) <name> 2) <name> 3) <name>
Special instructions: <notes | none>
Output files:
  <YYYY-MM-DD>_advance health directive_<Full Legal Name>.docx
  <YYYY-MM-DD>_health care proxy_<Full Legal Name>.docx
  <YYYY-MM-DD>_hcp preferences worksheet_<Full Legal Name>.docx
  <YYYY-MM-DD>_hipaa_<Full Legal Name>.docx
  <YYYY-MM-DD>_durable poa_<Full Legal Name>.docx

[CLIENT 2]  (omit entirely for an individual matter)
<same fields as CLIENT 1, plus the five output files for Client 2>
=== END ===
\`\`\``
}

function yn(value: boolean) {
  return value ? 'Yes' : 'No'
}

function unknown(value: unknown) {
  if (value === null || value === undefined || value === '') return '[UNKNOWN]'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[UNKNOWN]'
  return String(value)
}

function includedDocuments(documents: DraftPayload['documents']) {
  const rows = [
    ['Revocable living trust', documents.include_trust],
    ['Pour-over will', documents.include_pour_over_will],
    ['Simple will', documents.include_simple_will],
    ['Testamentary trust will', documents.include_testamentary_trust_will],
    ['Durable power of attorney', documents.include_dpoa],
    ['Health care proxy', documents.include_hcp],
    ['HIPAA authorization', documents.include_hipaa],
    ['Advance health directive', documents.include_ahd],
    ['Personal property memorandum', documents.include_ppm],
    ['Parental guardian appointment', documents.include_parental_appointment],
    ['Temporary delegation of parental powers', documents.include_temp_delegation],
  ] as const

  const selected = rows.filter(([, enabled]) => enabled).map(([label]) => `- ${label}`)
  if (documents.spouse_docs) selected.push('- Spouse companion documents where applicable')
  return selected.length ? selected.join('\n') : '- [UNKNOWN]'
}

function findMissingValues(value: unknown, pathName = 'payload'): string[] {
  if (value === null || value === undefined || value === '') return [pathName]
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    return value.flatMap((item, index) => findMissingValues(item, `${pathName}[${index}]`))
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => findMissingValues(child, `${pathName}.${key}`))
  }
  return []
}

/**
 * The factual, design-sheet-derived portion of the drafting payload — resolved
 * fiduciary names, trust/will/DPOA/HCP provisions, documents, and missing items.
 * Shared by the standalone "summarize for drafting" output and the matter chat
 * context so the trust/incapacity intake prompts can pre-fill from real values.
 */
function draftPayloadFactSheet(payload: DraftPayload) {
  const missing = findMissingValues(payload)
    .filter(item => !item.includes('.notes') && !item.includes('.special_provisions'))
    .slice(0, 40)

  return `Matter snapshot:
- Matter ID: ${payload.matter.id}
- Matter number: ${unknown(payload.matter.matter_number)}
- Jurisdiction: Massachusetts
- Plan type: ${payload.matter.type}
- Practice area: ${unknown(payload.matter.practice_area)}
- Trust type: ${unknown(payload.matter.trust_type)}
- Minor children: ${yn(payload.matter.minor_children)}
- Client: ${payload.client.full_name}
- Client DOB: ${unknown(payload.client.dob)}
- Client address: ${unknown(payload.client.address)}, ${unknown(payload.client.city)}, ${unknown(payload.client.state)} ${unknown(payload.client.zip)}
- Spouse: ${payload.spouse ? payload.spouse.full_name : '[UNKNOWN or not applicable]'}
- Signing month/year: ${unknown(payload.execution.signing_month)} ${unknown(payload.execution.signing_year)}
- Signing county: ${unknown(payload.execution.signing_county)}
- Notary commission expiration: ${unknown(payload.execution.notary_commission_expiration)}

Documents to draft:
${includedDocuments(payload.documents)}

People and fiduciaries:
- Personal representative primary: ${unknown(payload.fiduciaries.pr_primary)}
- Personal representative successor: ${unknown(payload.fiduciaries.pr_successor)}
- Personal representative second successor: ${unknown(payload.fiduciaries.pr_second_successor)}
- Trustee initial: ${unknown(payload.fiduciaries.trustee_initial)}
- Co-trustee: ${unknown(payload.fiduciaries.trustee_co)}
- Trustee successor: ${unknown(payload.fiduciaries.trustee_successor)}
- DPOA primary agent: ${unknown(payload.fiduciaries.dpoa_primary)}
- DPOA co-agent: ${unknown(payload.fiduciaries.dpoa_co_agent)}
- DPOA successor: ${unknown(payload.fiduciaries.dpoa_successor)}
- Health care proxy primary: ${unknown(payload.fiduciaries.hcp_primary)}
- Health care proxy successor: ${unknown(payload.fiduciaries.hcp_successor)}
- Guardian primary: ${unknown(payload.fiduciaries.guardian_primary)}
- Guardian successor: ${unknown(payload.fiduciaries.guardian_successor)}
- Spouse PR primary: ${unknown(payload.fiduciaries.spouse_pr_primary)}
- Spouse PR successor: ${unknown(payload.fiduciaries.spouse_pr_successor)}
- Spouse DPOA primary: ${unknown(payload.fiduciaries.spouse_dpoa_primary)}
- Spouse DPOA successor: ${unknown(payload.fiduciaries.spouse_dpoa_successor)}
- Spouse HCP primary: ${unknown(payload.fiduciaries.spouse_hcp_primary)}
- Spouse HCP successor: ${unknown(payload.fiduciaries.spouse_hcp_successor)}
- Spouse trustee successor: ${unknown(payload.fiduciaries.spouse_trustee_successor)}

Document provisions:
- Trust name: ${unknown(payload.trust?.name)}
- Trust date: ${unknown(payload.trust?.date)}
- Distribution ages: ${unknown(payload.trust?.distribution_ages)}
- MA estate taxable: ${payload.trust ? yn(payload.trust.ma_estate_taxable) : '[UNKNOWN]'}
- MA estate tax savings approach: ${unknown(payload.trust?.ma_estate_tax_savings)}
- Separate trusts: ${payload.trust ? yn(payload.trust.separate_trusts) : '[UNKNOWN]'}
- ILIT: ${payload.trust ? yn(payload.trust.has_ilit) : '[UNKNOWN]'}
- ILIT trustee: ${unknown(payload.trust?.ilit_trustee)}
- PR structure: ${unknown(payload.will_provisions.pr_structure)}
- Trustee structure: ${unknown(payload.will_provisions.trustee_structure)}
- Co-trustee decision standard: ${unknown(payload.will_provisions.cotrustee_decision_standard)}
- Bond: ${payload.will_provisions.bond}
- Supervision: ${payload.will_provisions.supervision}
- Simultaneous death: ${unknown(payload.will_provisions.simultaneous_death)}
- UTMA age: ${payload.will_provisions.utma_age}
- No-contest clause: ${payload.will_provisions.no_contest_clause}
- Disclaimer article: ${yn(payload.will_provisions.include_disclaimer_article)}
- Self-proving affidavit: ${yn(payload.will_provisions.include_self_proving_affidavit)}
- Tangible property distribution: ${unknown(payload.will_provisions.tangible_property_distribution)}
- Pour-over alternate disposition: ${unknown(payload.will_provisions.pour_over_alternate_disposition)}
- Outright residuary: ${unknown(payload.will_provisions.outright_residuary)}
- Beneficiary structure: ${unknown(payload.will_provisions.beneficiary_structure)}
- Age distribution schedule: ${unknown(payload.will_provisions.age_distribution_schedule)}
- Trust protector: ${unknown(payload.will_provisions.trust_protector_name)}
- Pet care option: ${payload.will_provisions.pet_care_option}
- DPOA co-agent manner: ${payload.dpoa_provisions.coagent_manner}
- DPOA self-dealing reviewer: ${unknown(payload.dpoa_provisions.self_dealing_reviewer)}
- DPOA Section L: ${yn(payload.dpoa_provisions.include_section_l)}
- HCP anatomical gift: ${unknown(payload.hcp_provisions.anatomical_gift)}
- HIPAA psychotherapy notes: ${unknown(payload.hipaa_provisions.psychotherapy_notes)}
- Ancillary documents: ${unknown(payload.ancillary_docs)}
- Special provisions: ${unknown(payload.special_provisions)}

Missing or attorney-review items:
${missing.length ? missing.map(item => `- ${item}`).join('\n') : '- None flagged by the normalized payload.'}`
}

function formatClaudeDraftingSkillInput(payload: DraftPayload) {
  return `Claude Drafting Skill Input

Role and task:
You are drafting Massachusetts estate-planning documents for Aubrey Law from attorney-approved design-sheet facts. Prepare draft-ready document instructions using only the facts below.

Non-invention rule:
Use only the provided facts. Do not invent names, dates, relationships, assets, tax conclusions, or fiduciary roles. If a value is missing or unclear, write [UNKNOWN] and preserve it as an attorney-review item.

${draftPayloadFactSheet(payload)}

Output requirements:
Draft clean, document-ready instructions for the selected Massachusetts estate-planning documents. Keep Massachusetts-specific assumptions explicit. Do not give client advice. Do not include facts not listed above.`
}

function generalSystemPrompt() {
  const firm = getFirmConfig()
  return `You are an AI legal assistant for ${firm.attorneyShortName}, a Massachusetts estate planning attorney at ${firm.firmName}.

You specialize in:
- Massachusetts estate planning law (wills, trusts, powers of attorney, healthcare proxies)
- Massachusetts probate procedure
- MA estate tax (threshold: $2M, top rate 16%, QTIP elections, credit shelter trusts)
- Practice management for a solo estate planning practice

You can also answer general questions about the attorney's pipeline, matter stages, and client management. If asked about a specific matter and you don't have its context, say so and suggest the attorney navigate to that matter page to ask there.

Be concise. Use plain language unless the attorney asks for technical detail.${trustDraftingIntakeInstructions()}${incapacityDesignSheetInstructions()}`
}

interface MatterContext {
  systemPrompt: string
  matterLabel: string | null
}

async function loadMatterContext(contextId: string): Promise<MatterContext> {
  const admin = getAdminClient()
  const matterRes = await admin
    .from('matters')
    .select(CHAT_MATTER_COLUMNS)
    .eq('id', contextId)
    .maybeSingle()

  if (matterRes.error) throw new Error(`matters: ${matterRes.error.message}`)
  const matter = matterRes.data as Row | null
  if (!matter) throw new Error('Matter not found')

  const intakeId = matter.client_intake_id
  const [pipelineRes, intakeRes, notesRes, detailsRes, designSheetRes, assetIntakeRes] = await Promise.all([
    admin.from('v_matter_pipeline').select(CHAT_PIPELINE_COLUMNS).eq('matter_id', contextId).maybeSingle(),
    intakeId
      ? admin.from('client_intake').select(CHAT_INTAKE_COLUMNS).eq('id', String(intakeId)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('matter_notes')
      .select(CHAT_MATTER_NOTE_COLUMNS)
      .eq('matter_id', contextId)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('matter_details').select(CHAT_MATTER_DETAILS_COLUMNS).eq('client_id', contextId).maybeSingle(),
    admin
      .from('design_sheets')
      .select(CHAT_DESIGN_SHEET_COLUMNS)
      .eq('matter_id', contextId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    intakeId
      ? admin
          .from('asset_intake')
          .select('category, description, value, ownership')
          .eq('client_intake_id', String(intakeId))
          .order('category')
      : Promise.resolve({ data: [], error: null }),
  ])

  const labeledResults = [
    ['v_matter_pipeline', pipelineRes],
    ['client_intake', intakeRes],
    ['matter_notes', notesRes],
    ['matter_details', detailsRes],
    ['design_sheets', designSheetRes],
    ['asset_intake', assetIntakeRes],
  ] as const
  for (const [label, res] of labeledResults) {
    if (res.error) {
      console.warn(`[admin chat] matter context: ${label} query failed`, {
        matterId: contextId,
        error: res.error.message,
      })
    }
  }

  const pipeline = pipelineRes.data as Row | null
  const rawIntake = intakeRes.data as Row | null
  const spouseContact = intakeId ? await loadSpouseContact(admin, String(intakeId)) : null
  const childContacts = intakeId ? await loadHouseholdChildren(admin, String(intakeId)) : []
  const intake: Row | null = rawIntake
    ? ({
        ...rawIntake,
        spouse_first_name: spouseContact?.first_name ?? null,
        spouse_last_name: spouseContact?.last_name ?? null,
        spouse_name: spouseContact
          ? [spouseContact.first_name, spouseContact.last_name].filter(Boolean).join(' ') || null
          : null,
        spouse_email: spouseContact?.email ?? null,
        spouse_phone: spouseContact?.phone ?? null,
        spouse_date_of_birth: spouseContact?.date_of_birth ?? null,
        // Children sourced from contacts (overlay), like spouse.
        children: childContacts,
      } as Row)
    : rawIntake
  const details = detailsRes.data as Row | null
  const designSheet = designSheetRes.data as Row | null
  const notes = (notesRes.data ?? []) as Row[]
  const assetIntakeRows = (assetIntakeRes.data ?? []) as Row[]

  const noteLines = notes.slice(0, 5).map(note => {
    const date = text(note.created_at)
    const kind = text(note.note_type, 'note')
    const body = text(note.body)
    return `- ${date} [${kind}] ${body}`
  }).join('\n') || '-'

  const firm = getFirmConfig()
  const practiceArea = (details?.practice_area ?? pipeline?.practice_area ?? '') as string
  const legalPlan = (details?.legal_plan ?? '') as string

  const designSheetImportNote = `\n\nDESIGN SHEET IMPORT TOOL: If the attorney asks to import, map, fill, update, or extract design-sheet fields from pasted or typed design-sheet text, call the \`${DESIGN_SHEET_IMPORT_TOOL_NAME}\` tool with the raw text they provided. The tool only proposes updates for attorney review; it never saves design-sheet data. Do not claim anything was saved unless the attorney uses the review flow.`
  const draftingSummaryNote = draftingSkillSummaryInstructions()
  const trustIntakeNote = trustDraftingIntakeInstructions()
  const incapacityIntakeNote = incapacityDesignSheetInstructions()

  // Normalized design-sheet facts (resolved fiduciary names, trust/will/DPOA/HCP
  // provisions, documents). This is the richest view of the design sheet and is
  // what the trust + incapacity intake prompts pre-fill from. Guarded so an
  // incomplete design sheet never breaks the chat — we fall back to the summary
  // fields above.
  let designSheetSection = ''
  try {
    const draftPayload = await buildDraftPayload(contextId)
    designSheetSection = `\n\nDESIGN SHEET (normalized from the attorney-entered design sheet — treat these resolved values as the source of truth for trust and incapacity drafting; pre-fill from them and only ask Scott for items shown as [UNKNOWN]):\n\n${draftPayloadFactSheet(draftPayload)}`
  } catch (error) {
    console.warn('[admin chat] design sheet payload unavailable for context', {
      matterId: contextId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const systemPrompt = `You are an AI legal assistant for ${firm.attorneyShortName}, a Massachusetts estate planning attorney at ${firm.firmName}.

You have full context for this matter:

CLIENT: ${fullName(intake)}, ${text(intake?.marital_status ?? pipeline?.marital_status)}, DOB ${text(intake?.date_of_birth ?? pipeline?.client_dob)}
MATTER: ${text(matter.matter_number)} - ${text(practiceArea)} - Stage: ${text(matter.stage ?? pipeline?.stage)} - Status: ${text(matter.status ?? pipeline?.status)}
MATTER NAME: ${text(matter.name ?? pipeline?.matter_name)}
PLAN TYPE: ${text(details?.ep_plan_category ?? details?.plan_type ?? intake?.plan_type ?? pipeline?.plan_type)}
LEGAL PLAN: ${text(legalPlan || '-')} ${details?.legal_plan_id ? `(Member ID ${text(details.legal_plan_id)})` : ''}
${formatIntakeQuestionnaire(intake, pipeline)}
${formatDesignSheetSummary(designSheet)}
ASSETS:
${summarizeAssets(intake, designSheet, assetIntakeRows)}
FAMILY:
${summarizeFamily(intake, pipeline)}
FIDUCIARIES:
${summarizeFiduciaries(intake, designSheet)}
SPECIAL CONCERNS: ${text(designSheet?.concerns ?? intake?.concerns ?? intake?.special_notes ?? intake?.planning_objectives)}
RECENT NOTES:
${noteLines}${designSheetSection}

Respond in plain, concise attorney-facing language. You may draft text (emails, summaries, clauses) when asked. Always flag if you're uncertain. Do not invent facts not present in the context above.${designSheetImportNote}${draftingSummaryNote}${trustIntakeNote}${incapacityIntakeNote}`

  const matterLabel = [
    text(matter.name ?? pipeline?.matter_name, ''),
    matter.matter_number ? `#${text(matter.matter_number, '')}` : '',
  ].filter(Boolean).join(' · ') || null

  return {
    systemPrompt,
    matterLabel,
  }
}

async function buildContext(contextType: ChatContextType, contextId?: string): Promise<MatterContext> {
  if (contextType === 'matter') {
    if (!contextId) throw new Error('context_id required for matter chat')
    return loadMatterContext(contextId)
  }
  return {
    systemPrompt: generalSystemPrompt(),
    matterLabel: null,
  }
}

const DESIGN_SHEET_IMPORT_TOOL: Anthropic.Tool = {
  name: DESIGN_SHEET_IMPORT_TOOL_NAME,
  description:
    'Parse attorney-provided pasted or typed text into proposed design-sheet field updates for the current matter. ' +
    'The tool returns preview rows and a proposed field map only; it does not write to the database.',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Raw pasted or typed design-sheet text to parse. Do not summarize before passing it.',
      },
    },
    required: ['text'],
  },
}

function sse(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: Request) {
  const { err, userId: adminUserId } = await requireAdmin(req)
  if (err) return err

  // Rate limit Cowork chat: 60 calls per 10-minute window per admin.
  // Anthropic spend is the dominant cost; a runaway loop would burn through
  // a budget in minutes. 60/10min ≈ one message every 10 seconds sustained.
  const rl = await consumeRateLimit(
    { bucket: 'admin_chat', limit: 60, windowSeconds: 600 },
    adminUserId ?? 'anon',
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for chat', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await req.json().catch(() => null) as ChatRequest | null
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'Invalid chat request' }, { status: 400 })
  }

  const contextType = body.context_type
  if (!['matter', 'general'].includes(contextType)) {
    return NextResponse.json({ error: 'Invalid context_type' }, { status: 400 })
  }

  const requestMessages = body.messages
    .filter(message =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim()
    )
    .map(message => ({ role: message.role, content: message.content.trim() }))

  if (requestMessages.length === 0) {
    return NextResponse.json({ error: 'At least one message is required' }, { status: 400 })
  }

  const lastUserMessage = [...requestMessages].reverse().find(message => message.role === 'user')?.content ?? ''
  if (contextType === 'matter' && body.context_id && isDraftingSummaryRequest(lastUserMessage)) {
    try {
      const payload = await buildDraftPayload(body.context_id)
      const textOutput = formatClaudeDraftingSkillInput(payload)
      return new Response(`${sse({ text: textOutput })}data: [DONE]\n\n`, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to summarize design sheet' },
        { status: 500 },
      )
    }
  }

  let contextLoadNote = ''
  let context: MatterContext
  try {
    context = await buildContext(contextType, body.context_id)
  } catch (error) {
    const detail = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string')
        ? (error as { message: string }).message
        : JSON.stringify(error)
    console.error('[admin chat] context fetch failed', {
      contextType,
      contextId: body.context_id,
      error: detail,
      stack: error instanceof Error ? error.stack : undefined,
    })
    context = { systemPrompt: generalSystemPrompt(), matterLabel: null }
    contextLoadNote = `Note: I wasn't able to load full matter context (${detail}) - answering from general knowledge.\n\n`
  }

  const userId = adminUserId
  const contextMatterId = contextType === 'matter' && body.context_id ? body.context_id : null
  const tools: Anthropic.Tool[] = [
    ...(contextMatterId ? [DESIGN_SHEET_IMPORT_TOOL] : []),
  ]

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now()
      const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      const chatModel = await resolveFirmModel('assistant')
      let usageModel = chatModel
      const anthropic = await getAnthropicClient()
      try {
        if (contextLoadNote) {
          controller.enqueue(encoder.encode(sse({ text: contextLoadNote })))
        }

        const conversation: Anthropic.MessageParam[] = requestMessages.map(message => ({
          role: message.role,
          content: message.content,
        }))

        // Tool-use loop. We cap iterations defensively.
        for (let iteration = 0; iteration < 4; iteration++) {
          const anthropicStream = anthropic.messages.stream({
            model: chatModel,
            max_tokens: 2048,
            system: context.systemPrompt,
            messages: conversation,
            ...(tools.length > 0 ? { tools } : {}),
          })

          for await (const event of anthropicStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(sse({ text: event.delta.text })))
            }
          }

          const finalMessage = await anthropicStream.finalMessage()
          if (finalMessage.model) usageModel = finalMessage.model
          usageTotals.input += finalMessage.usage?.input_tokens ?? 0
          usageTotals.output += finalMessage.usage?.output_tokens ?? 0
          usageTotals.cacheRead += finalMessage.usage?.cache_read_input_tokens ?? 0
          usageTotals.cacheWrite += finalMessage.usage?.cache_creation_input_tokens ?? 0

          if (finalMessage.stop_reason !== 'tool_use') {
            break
          }

          const toolUseBlocks = finalMessage.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
          )

          conversation.push({ role: 'assistant', content: finalMessage.content })

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const block of toolUseBlocks) {
            if (block.name === DESIGN_SHEET_IMPORT_TOOL_NAME && contextMatterId) {
              controller.enqueue(encoder.encode(sse({
                tool: DESIGN_SHEET_IMPORT_TOOL_NAME,
                tool_use_id: block.id,
                status: 'running',
              })))
              try {
                const input = block.input as { text?: unknown }
                const result = await parseDesignSheetImportText({
                  matterId: contextMatterId,
                  text: typeof input.text === 'string' ? input.text : '',
                  userId: adminUserId ?? '',
                })
                controller.enqueue(encoder.encode(sse({
                  tool: DESIGN_SHEET_IMPORT_TOOL_NAME,
                  tool_use_id: block.id,
                  status: 'done',
                  result: {
                    matter_id: contextMatterId,
                    proposed: result.proposed,
                    preview: result.preview,
                  },
                })))
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    ok: true,
                    proposed_field_count: result.preview.length,
                    message: 'Design sheet updates are ready for attorney review in the UI. They have not been saved.',
                  }),
                })
              } catch (toolError) {
                const message = (toolError as Error).message ?? 'Unknown error'
                controller.enqueue(encoder.encode(sse({
                  tool: DESIGN_SHEET_IMPORT_TOOL_NAME,
                  tool_use_id: block.id,
                  status: 'error',
                  error: message,
                })))
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify({ ok: false, error: message }),
                  is_error: true,
                })
              }
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: 'Tool not available in this context.' }),
                is_error: true,
              })
            }
          }

          conversation.push({ role: 'user', content: toolResults })
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()

        void logAiUsage({
          route: 'admin/chat',
          contextType,
          matterId: contextType === 'matter' ? body.context_id ?? null : null,
          userId,
          model: usageModel,
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output,
          cacheReadInputTokens: usageTotals.cacheRead,
          cacheCreationInputTokens: usageTotals.cacheWrite,
          durationMs: Date.now() - startedAt,
          success: true,
        })
      } catch (error) {
        console.error('[admin chat] anthropic stream failed', error)
        controller.enqueue(encoder.encode(sse({ error: 'Chat unavailable - try again in a moment.' })))
        controller.close()
        void logAiUsage({
          route: 'admin/chat',
          contextType,
          matterId: contextType === 'matter' ? body.context_id ?? null : null,
          userId,
          model: usageModel,
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output,
          cacheReadInputTokens: usageTotals.cacheRead,
          cacheCreationInputTokens: usageTotals.cacheWrite,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
