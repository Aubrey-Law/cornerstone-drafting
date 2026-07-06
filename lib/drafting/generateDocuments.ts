import type { SupabaseClient } from '@supabase/supabase-js'
import PizZip from 'pizzip'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { docSelectionTemplateKey } from '@/lib/drafting/docSelectionKey'
import { projectDraftPayloadToFlatSheet } from '@/lib/drafting/projectDesignSheet'
import { buildClientVariables, buildSpouseVariables, escapeXml } from '@/lib/drafting/variables'
import type { DraftPayload } from '@/lib/buildDraftPayload'

export interface GeneratedFile {
  name: string
  buffer: Buffer
}

export type GenerateDocumentsResult =
  | { ok: true; files: GeneratedFile[]; missing: string[]; clientSlug: string }
  | { ok: false; error: string; status: number }

function templateAllowedBySelectedDocuments(templateKey: string, documents?: DraftPayload['documents']) {
  if (!documents) return true

  const key = templateKey.toLowerCase()
  const baseKey = key.endsWith(':spouse') ? key.slice(0, -7) : key

  if (key.endsWith(':spouse') && !documents.spouse_docs) return false
  if (baseKey.includes('deed')) return false
  if (baseKey.includes('trust') && !baseKey.includes('testamentary')) return documents.include_trust
  if (baseKey.includes('dpoa') || baseKey.includes('power_of_attorney') || baseKey.includes('power-of-attorney')) return documents.include_dpoa
  if (baseKey.includes('hcp') || baseKey.includes('health')) return documents.include_hcp
  if (baseKey.includes('hipaa')) return documents.include_hipaa
  if (baseKey.includes('ahd') || baseKey.includes('advance') || baseKey.includes('living_will')) return documents.include_ahd
  if (baseKey.includes('memo') || baseKey.includes('personal_property')) return documents.include_ppm
  if (baseKey.includes('will')) {
    return documents.include_pour_over_will ||
      documents.include_simple_will ||
      documents.include_testamentary_trust_will
  }

  return true
}

function fillDocx(templateBuffer: Buffer, variables: Record<string, string>): Buffer {
  const zip = new PizZip(templateBuffer)

  for (const fileName of Object.keys(zip.files)) {
    if (!zip.files[fileName].dir && (fileName.endsWith('.xml') || fileName.endsWith('.rels'))) {
      let content = zip.files[fileName].asText()
      for (const [placeholder, value] of Object.entries(variables)) {
        content = content.replaceAll(placeholder, escapeXml(value))
      }
      zip.file(fileName, content)
    }
  }

  return Buffer.from(zip.generate({ type: 'uint8array', compression: 'DEFLATE' }))
}

/**
 * Core document generation logic.
 * Fetches selected templates for the given design sheet, fills them with
 * client/spouse variables, logs the draft, and returns individual file buffers.
 * Callers are responsible for auth checks before calling this function.
 */
export async function generateDocuments(
  sb: SupabaseClient,
  sheetId: string,
  userId: string,
  documents?: DraftPayload['documents'],
): Promise<GenerateDocumentsResult> {
  const { data: sheet, error: sheetError } = await sb
    .from('design_sheets')
    .select('*')
    .eq('id', sheetId)
    .single()

  if (sheetError || !sheet) return { ok: false, error: 'Sheet not found', status: 404 }

  const matterId = sheet.matter_id as string | undefined
  if (!matterId) return { ok: false, error: 'Design sheet is missing matter_id', status: 422 }

  let payload: DraftPayload
  try {
    payload = await buildDraftPayload(matterId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build draft payload'
    return { ok: false, error: message, status: 422 }
  }

  const flatSheet = projectDraftPayloadToFlatSheet(payload)

  const { data: selections } = await sb
    .from('doc_selections')
    .select('doc_type, variant, party, selected')
    .eq('design_sheet_id', sheetId)
    .eq('selected', true)
    .order('sort_order', { ascending: true })

  const selectedTemplates = (selections ?? [])
    .map(selection => docSelectionTemplateKey(selection))
    .filter((key): key is string => key != null)
    .filter(key => templateAllowedBySelectedDocuments(key, documents))

  if (!selectedTemplates.length) return { ok: false, error: 'No documents selected', status: 400 }

  const files: GeneratedFile[] = []
  const missing: string[] = []

  const templateCache = new Map<string, Buffer>()

  for (const key of selectedTemplates) {
    const isSpouse = key.endsWith(':spouse')
    const filename = isSpouse ? key.slice(0, -7) : key
    const variables = isSpouse ? buildSpouseVariables(flatSheet) : buildClientVariables(flatSheet)

    if (!templateCache.has(filename)) {
      const { data: blob, error } = await sb.storage.from('templates').download(filename)
      if (error || !blob) {
        missing.push(`${key}(${error?.message ?? 'no blob'})`)
        continue
      }
      templateCache.set(filename, Buffer.from(await blob.arrayBuffer()))
    }

    const templateBuffer = templateCache.get(filename)!
    const filledBuffer = fillDocx(templateBuffer, variables)

    const baseName = filename.replace(/\.docx$/i, '')
    const suffix = isSpouse ? '_Spouse' : '_Client'
    files.push({ name: baseName + suffix + '.docx', buffer: filledBuffer })
  }

  if (!files.length) {
    return { ok: false, error: 'No templates found in storage', status: 422 }
  }

  const documentsGenerated = files.map(f => f.name)

  await Promise.all([
    sb.from('draft_log').insert({
      design_sheet_id: sheetId,
      drafted_by: userId,
      sheet_version: sheet.version,
      documents_generated: documentsGenerated,
      missing_fields: missing.length ? missing : null,
    }),
    sb.from('design_sheets').update({ status: 'generated' }).eq('id', sheetId),
  ])

  const clientSlug = (sheet.client_name as string | null)?.replace(/\s+/g, '-') ?? sheetId

  return { ok: true, files, missing, clientSlug }
}
