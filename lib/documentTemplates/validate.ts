import { renderSingleTemplateForMatter } from '@/lib/drafting/quickDraft'
import { renderRealEstateTransferDocx } from '@/lib/realEstateTransfer/generate'
import { DEED_TEMPLATE_VARIANTS, DOCUMENT_TYPES, type RealEstateTransferDocType } from '@/lib/realEstateTransfer/fields'
import { buildFormStateFromDesignSheet } from '@/lib/designSheetRealEstateTransfer'
import { buildTemplateFields } from '@/lib/realEstateTransfer/formState'
import { renderEngagementAgreement } from '@/lib/engagement/render'
import type { EngagementInput } from '@/lib/engagement/types'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import { documentTemplateAdminClient } from './repository'
import { getDocumentTemplateDefinition } from './registry'
import { sha256 } from './docx'
import type { DocumentTemplateValidationReport, ResolvedDocumentTemplate } from './types'
import { loadMatterContacts } from '@/lib/contacts/loadMatterContacts'

export interface CandidateValidationResult {
  report: DocumentTemplateValidationReport
  preview: Buffer | null
  previewContentType: string
  previewFilename: string | null
}

function invalid(matterId: string, error: unknown): CandidateValidationResult {
  return {
    report: {
      valid: false,
      generatedAt: new Date().toISOString(),
      matterId,
      outputFilename: null,
      unresolvedMarkers: [],
      missingFields: [],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    },
    preview: null,
    previewContentType: 'application/octet-stream',
    previewFilename: null,
  }
}

async function validateEstate(templateId: string, buffer: Buffer, matterId: string): Promise<CandidateValidationResult> {
  const rendered = await renderSingleTemplateForMatter({ matterId, templateId, templateBuffer: buffer })
  const unresolved = rendered.unresolvedMarkers
  const report: DocumentTemplateValidationReport = {
    valid: unresolved.length === 0,
    generatedAt: new Date().toISOString(),
    matterId,
    outputFilename: rendered.outputFilename,
    unresolvedMarkers: unresolved,
    missingFields: rendered.missingFields,
    warnings: rendered.warnings,
    ...(unresolved.length ? { error: 'Rendered preview contains unresolved template markers.' } : {}),
  }
  return {
    report,
    preview: rendered.buffer,
    previewContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    previewFilename: rendered.outputFilename,
  }
}

async function validateRealEstate(templateId: string, buffer: Buffer, matterId: string): Promise<CandidateValidationResult> {
  const definition = getDocumentTemplateDefinition(templateId)!
  const admin = documentTemplateAdminClient()
  const [{ data: matter }, { data: sheet }] = await Promise.all([
    admin.from('matters').select('*').eq('id', matterId).maybeSingle(),
    admin.from('design_sheets').select('*').eq('matter_id', matterId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!matter || !sheet) throw new Error('The selected matter needs a design sheet for this preview.')
  const contacts = await loadMatterContacts(admin, matterId)
  const form = buildFormStateFromDesignSheet(
    sheet as DesignSheet,
    matter as PipelineMatter,
    (contacts ?? []) as unknown as MatterContact[],
  )
  const fields = buildTemplateFields(form)
  const deedVariant = Object.values(DEED_TEMPLATE_VARIANTS)
    .find(meta => definition.bundledPath.endsWith(`/${meta.templateFile}`))
  const entry = Object.entries(DOCUMENT_TYPES)
    .find(([, meta]) => definition.bundledPath.endsWith(`/${meta.templateFile}`))
  if (!deedVariant && !entry) throw new Error('Real-estate template registry entry is invalid.')
  const docType = deedVariant ? 'deed' : entry![0] as RealEstateTransferDocType
  const meta = deedVariant ?? entry![1]
  const preview = renderRealEstateTransferDocx(docType, fields, buffer)
  const filename = `${meta.downloadBaseName}.docx`
  return {
    report: {
      valid: true,
      generatedAt: new Date().toISOString(),
      matterId,
      outputFilename: filename,
      unresolvedMarkers: [],
      missingFields: [],
      warnings: [],
    },
    preview,
    previewContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    previewFilename: filename,
  }
}

async function validateEngagement(templateId: string, buffer: Buffer, matterId: string): Promise<CandidateValidationResult> {
  const admin = documentTemplateAdminClient()
  const { data: agreement } = await admin
    .from('engagement_agreements')
    .select('active_revision_id')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!agreement?.active_revision_id) throw new Error('The selected matter needs an engagement-agreement draft for this preview.')
  const { data: revision, error } = await admin
    .from('engagement_agreement_revisions')
    .select('input_snapshot')
    .eq('id', agreement.active_revision_id)
    .maybeSingle()
  if (error || !revision) throw new Error(error?.message ?? 'Engagement revision not found')
  const definition = getDocumentTemplateDefinition(templateId)!
  const template: ResolvedDocumentTemplate = {
    definition,
    buffer,
    source: 'published',
    versionId: 'candidate',
    versionLabel: 'Candidate',
    sha256: sha256(buffer),
  }
  const rendered = await renderEngagementAgreement(revision.input_snapshot as EngagementInput, { template })
  return {
    report: {
      valid: true,
      generatedAt: new Date().toISOString(),
      matterId,
      outputFilename: 'engagement-agreement-preview.pdf',
      unresolvedMarkers: [],
      missingFields: [],
      warnings: [],
    },
    preview: rendered.pdfBytes,
    previewContentType: 'application/pdf',
    previewFilename: 'engagement-agreement-preview.pdf',
  }
}

export async function validateDocumentTemplateCandidate(
  templateId: string,
  buffer: Buffer,
  matterId: string,
): Promise<CandidateValidationResult> {
  const definition = getDocumentTemplateDefinition(templateId)
  if (!definition) return invalid(matterId, 'Unknown document template.')
  try {
    if (definition.category === 'estate') return await validateEstate(templateId, buffer, matterId)
    if (definition.category === 'real_estate') return await validateRealEstate(templateId, buffer, matterId)
    return await validateEngagement(templateId, buffer, matterId)
  } catch (error) {
    return invalid(matterId, error)
  }
}
