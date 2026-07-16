export type EstateDocumentType =
  | 'will'
  | 'trust'
  | 'durable_power_of_attorney'
  | 'health_care_directive'
  | 'hipaa_authorization'
  | 'ancillary'

export type EstateClauseOverrideAction = 'force_include' | 'force_omit'

export interface EstateClauseContent {
  text: string
  requiredFields: string[]
  nestedClauseKeys: string[]
  conditionField?: string | null
}

export interface PublishedEstateClause extends EstateClauseContent {
  clauseId: string
  clauseKey: string
  title: string
  jurisdiction: 'MA'
  documentTypes: EstateDocumentType[]
  revisionId: string
  revisionNumber: number
  contentHash: string
  reviewStatus: string
  sourceFile?: string
  sourceJurisdiction?: string
}

export interface EstateClauseOverride {
  id: string
  clauseId: string
  clauseKey: string
  action: EstateClauseOverrideAction
  reason: string
  actorId: string
}

export interface EstateClauseManifestEntry {
  clauseId: string
  clauseKey: string
  revisionId: string
  contentHash: string
  inclusionPosition: number
  selectionReason: 'template_rule' | 'attorney_override'
  overrideId: string | null
}

export interface EstateClauseSnapshot {
  jurisdiction: 'MA'
  clauses: ReadonlyMap<string, PublishedEstateClause>
  overrides: ReadonlyMap<string, EstateClauseOverride>
  source: 'database' | 'file'
}
