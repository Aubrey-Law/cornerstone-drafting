import type { DraftPayload } from '@/lib/draftPayload/types'
import {
  buildFormStateFromDesignSheet,
  getPersistedRealEstateTransfer,
} from '@/lib/designSheetRealEstateTransfer'
import {
  DOCUMENT_TYPES,
  type RealEstateTransferDocType,
} from '@/lib/realEstateTransfer/fields'
import { buildTemplateFields } from '@/lib/realEstateTransfer/formState'
import {
  realEstateTransferTemplateMeta,
  resolveAndRenderRealEstateTransferDocx,
} from '@/lib/realEstateTransfer/generate'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'

export const REAL_ESTATE_TRANSFER_PACKAGE = 'real-estate-transfer' as const

export function selectedRealEstateTransferDocTypes(
  documents: DraftPayload['documents'],
): RealEstateTransferDocType[] {
  const docs: RealEstateTransferDocType[] = []
  if (documents.include_deed) docs.push('deed')
  if (documents.include_trustees_certificate) docs.push('trustees_certificate')
  if (documents.include_real_estate_trust) docs.push('real_estate_trust')
  return docs
}

export function assetTransferPreflightDocuments(
  documents: DraftPayload['documents'],
): Array<{ packageName: typeof REAL_ESTATE_TRANSFER_PACKAGE; title: string; filename: string }> {
  return selectedRealEstateTransferDocTypes(documents).map(docType => ({
    packageName: REAL_ESTATE_TRANSFER_PACKAGE,
    title: DOCUMENT_TYPES[docType].label,
    filename: `${DOCUMENT_TYPES[docType].downloadBaseName}.docx`,
  }))
}

export async function generateAssetTransferFilesFromDesignSheet(
  sheet: DesignSheet,
  matter: Pick<PipelineMatter, 'client_name' | 'spouse_name'>,
  contacts: MatterContact[],
  documents: DraftPayload['documents'],
): Promise<Array<{
  name: string
  buffer: Buffer
  title: string
  templateId: string
  templateVersionId: string | null
  templateSource: 'bundled' | 'published'
}>> {
  const docTypes = selectedRealEstateTransferDocTypes(documents)
  if (docTypes.length === 0) return []

  const form = buildFormStateFromDesignSheet(sheet, matter as PipelineMatter, contacts)
  // Prefer persisted selectedDocs when payload flags are out of sync with the sheet.
  const persisted = getPersistedRealEstateTransfer(sheet)
  const effectiveTypes = docTypes.length > 0
    ? docTypes
    : persisted.selectedDocs
  if (effectiveTypes.length === 0) return []

  const fields = buildTemplateFields(form)

  return Promise.all(effectiveTypes.map(async docType => {
    const meta = realEstateTransferTemplateMeta(docType, fields)
    const resolved = await resolveAndRenderRealEstateTransferDocx(docType, fields)
    return {
      name: `${meta.downloadBaseName}.docx`,
      buffer: resolved.buffer,
      title: meta.label,
      templateId: resolved.template.definition.id,
      templateVersionId: resolved.template.versionId,
      templateSource: resolved.template.source,
    }
  }))
}
