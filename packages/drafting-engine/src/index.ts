/**
 * @aubrey-law/drafting-engine — the pure half of Aubrey Law's document
 * generation: Nunjucks-over-DOCX rendering, clause resolution, style sets,
 * tracked changes and marker scanning.
 *
 * Nothing here touches Supabase, R2, `next/*` or authentication. Everything it
 * needs is passed in. That is what lets a second application use it without
 * inheriting the first application's infrastructure.
 *
 * The matter-shaped layer above this — buildDraftPayload, toGeneratorData, the
 * design sheet — deliberately stays in the app. It is the domain model, not a
 * library.
 *
 * This barrel names the surface other code should rely on. Deep imports still
 * work (`@aubrey-law/drafting-engine/estateGenerator/node/config`) and are used
 * by the shims in `lib/`, but anything re-exported here is the supported API.
 */

// Generation — rendering, packages, clause store, jurisdiction rules
export { resolveEstateGeneratorRoot, DEFAULT_GENERATOR_ROOT } from './estateGenerator/runtime'
export {
  loadNodeEstatePackage,
  loadNodeEstateStateRules,
  resolveNodeEstateGeneratorRoot,
} from './estateGenerator/node/config'
export { buildNodeEstateContext } from './estateGenerator/node/context'
export { createNodeClauseStore } from './estateGenerator/node/clauses'
export { renderNodeEstateDocxTemplate } from './estateGenerator/node/templateRenderer'
export { renderNodeEstateText } from './estateGenerator/node/renderText'
export { dataForNodeEstatePackage, youngAdultEstatePlanData } from './estateGenerator/node/packageData'
export { conditionalMissingFieldsForPackage } from './estateGenerator/node/packageValidation'
export { llmDraftFallbackEnabled, llmFallbackEngineLabel } from './estateGenerator/engine'

// Clause library — the pure repository half; the DB-backed store stays app-side
export { loadBundledEstateClauseSnapshot } from './estateClauses/fileRepository'
export { loadEstateClauseSnapshot } from './estateClauses/source'

// DOCX utilities — tracked changes, marker QA, the edit protocol
export { scanDocxBufferForMarkers } from './drafting/markerScan'
export {
  applyTrackedEdits,
  applyTrackedEditsAtOffsets,
  extractDocxBodyText,
  extractDocxParagraphs,
} from './docxTrackedChanges'
export type { OffsetEditInput } from './docxTrackedChanges'

// Formatting
export { applyStyleSetToDocxBuffer } from './styleSets/applyToDocx'
export { DEFAULT_STYLE_SET } from './styleSets/defaults'

// Shared value helpers that moved with the engine
export { normalizeJurisdictionStateCode } from './jurisdictionState'

export type { NodeEstateData, NodeEstatePackageName, NodeEstateStateRules } from './estateGenerator/node/types'
export type { EstateClauseClient } from './estateClauses/repository'
export type { EstateClauseSnapshot, EstateDocumentType } from './estateClauses/types'
export type { StyleSetSettings } from './styleSets/schema'
export type { ResolvedDocumentTemplate } from './documentTemplates/types'
