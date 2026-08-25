import {
  getExecutionMechanics,
  type ExecutionMechanics,
} from '@/lib/designSheet/executionMechanics'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

/**
 * Signing and acknowledgment answers, straight through from the design sheet.
 *
 * Nothing is derived here — the interface is the namespace's — but the payload
 * keeps its own type so a future computed field (for example, "does this plan
 * need a notary at all") has somewhere to live without widening the storage
 * interface.
 */
export type DraftPayloadExecutionMechanics = ExecutionMechanics

export function draftPayloadExecutionMechanics(
  designSheet: DesignSheetRow,
): DraftPayloadExecutionMechanics {
  return getExecutionMechanics({ decisions: designSheet.decisions ?? null })
}
