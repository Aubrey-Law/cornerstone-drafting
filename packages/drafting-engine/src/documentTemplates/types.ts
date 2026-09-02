export type DocumentTemplateCategory = 'estate' | 'real_estate' | 'engagement'
export type DocumentTemplateRenderer = 'estate_nunjucks' | 'real_estate_docxtemplater' | 'engagement_docxtemplater'
export type DocumentTemplateSource = 'bundled' | 'published'

export interface DocumentTemplateDefinition {
  id: string
  label: string
  category: DocumentTemplateCategory
  renderer: DocumentTemplateRenderer
  bundledPath: string
  packageNames: string[]
}

export interface ResolvedDocumentTemplate {
  definition: DocumentTemplateDefinition
  buffer: Buffer
  source: DocumentTemplateSource
  versionId: string | null
  versionLabel: string
  sha256: string
}

export interface DocumentTemplateValidationReport {
  valid: boolean
  generatedAt: string
  matterId: string
  outputFilename: string | null
  unresolvedMarkers: string[]
  missingFields: string[]
  warnings: string[]
  error?: string
}

