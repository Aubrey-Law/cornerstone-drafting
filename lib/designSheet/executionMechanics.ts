/**
 * How the plan gets executed: which documents are notarised, which are
 * witnessed, and the meeting details that go on the signature pages.
 *
 * These live in `decisions.execution_mechanics` rather than as columns. The
 * three signing fields that *are* columns — `signing_date`, `signing_county`,
 * `notary_commission_expiration` — predate the decisions blob; adding more
 * columns means a migration and the PostgREST failure mode
 * `WRITABLE_DESIGN_SHEET_COLUMNS` guards against, for no gain. The UI shows
 * both sets together on the Review step.
 */
import { readAllowedValue } from '@/lib/designSheet/decisionReaders'
import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** How a document is acknowledged. The trust may take both. */
export type TrustAcknowledgment = 'notary' | 'witnesses' | 'both'
export const TRUST_ACKNOWLEDGMENTS: readonly TrustAcknowledgment[] =
  ['notary', 'witnesses', 'both'] as const

export type DocumentAcknowledgment = 'notary' | 'witnesses'
export const DOCUMENT_ACKNOWLEDGMENTS: readonly DocumentAcknowledgment[] =
  ['notary', 'witnesses'] as const

/** Final disposition needs two witnesses, optionally plus a notary. */
export type FinalDispositionExecution = 'witnesses' | 'witnesses_and_notary'
export const FINAL_DISPOSITION_EXECUTIONS: readonly FinalDispositionExecution[] =
  ['witnesses', 'witnesses_and_notary'] as const

export interface ExecutionMechanics {
  trust_acknowledgment: TrustAcknowledgment | null
  poa_acknowledgment: DocumentAcknowledgment | null
  ahd_acknowledgment: DocumentAcknowledgment | null
  healthcare_authorization_acknowledgment: DocumentAcknowledgment | null
  final_disposition_execution: FinalDispositionExecution | null
  combine_settlor_trustee_signatures: boolean
  healthcare_signed_in_nursing_home: boolean
  signing_city: string | null
  notary_name: string | null
  include_witness_phones: boolean
  witness_1_address: string | null
  witness_1_phone: string | null
  witness_2_address: string | null
  witness_2_phone: string | null
}

const DEFAULT_EXECUTION_MECHANICS: ExecutionMechanics = {
  trust_acknowledgment: null,
  poa_acknowledgment: null,
  ahd_acknowledgment: null,
  healthcare_authorization_acknowledgment: null,
  final_disposition_execution: null,
  combine_settlor_trustee_signatures: false,
  healthcare_signed_in_nursing_home: false,
  signing_city: null,
  notary_name: null,
  include_witness_phones: false,
  witness_1_address: null,
  witness_1_phone: null,
  witness_2_address: null,
  witness_2_phone: null,
}

function executionMechanicsRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.execution_mechanics
  return isRecord(raw) ? raw : {}
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback
}

function readText(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function getExecutionMechanics(sheet: Pick<DesignSheet, 'decisions'>): ExecutionMechanics {
  const raw = executionMechanicsRaw(sheet)

  return {
    trust_acknowledgment: readAllowedValue(raw, 'trust_acknowledgment', TRUST_ACKNOWLEDGMENTS),
    poa_acknowledgment: readAllowedValue(raw, 'poa_acknowledgment', DOCUMENT_ACKNOWLEDGMENTS),
    ahd_acknowledgment: readAllowedValue(raw, 'ahd_acknowledgment', DOCUMENT_ACKNOWLEDGMENTS),
    healthcare_authorization_acknowledgment: readAllowedValue(
      raw, 'healthcare_authorization_acknowledgment', DOCUMENT_ACKNOWLEDGMENTS,
    ),
    final_disposition_execution: readAllowedValue(
      raw, 'final_disposition_execution', FINAL_DISPOSITION_EXECUTIONS,
    ),
    combine_settlor_trustee_signatures: readBoolean(
      raw, 'combine_settlor_trustee_signatures',
      DEFAULT_EXECUTION_MECHANICS.combine_settlor_trustee_signatures,
    ),
    healthcare_signed_in_nursing_home: readBoolean(
      raw, 'healthcare_signed_in_nursing_home',
      DEFAULT_EXECUTION_MECHANICS.healthcare_signed_in_nursing_home,
    ),
    signing_city: readText(raw, 'signing_city'),
    notary_name: readText(raw, 'notary_name'),
    include_witness_phones: readBoolean(
      raw, 'include_witness_phones', DEFAULT_EXECUTION_MECHANICS.include_witness_phones,
    ),
    witness_1_address: readText(raw, 'witness_1_address'),
    witness_1_phone: readText(raw, 'witness_1_phone'),
    witness_2_address: readText(raw, 'witness_2_address'),
    witness_2_phone: readText(raw, 'witness_2_phone'),
  }
}

/**
 * Spreads `...raw` first, the way `setTrustDetails` does, so a key stored here
 * that this interface has never heard of survives every future write. The
 * `dpoa_provisions` and `healthcare_provisions` setters rebuild from their
 * getters instead and silently drop such keys; this is the safer shape.
 */
export function setExecutionMechanics(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<ExecutionMechanics>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = executionMechanicsRaw(sheet)
  const current = getExecutionMechanics(sheet)

  return {
    ...decisions,
    execution_mechanics: { ...raw, ...current, ...patch },
  }
}
