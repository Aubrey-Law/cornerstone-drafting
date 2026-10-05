import 'server-only'

import type Anthropic from '@anthropic-ai/sdk'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import {
  coerceScanReading,
  EMPTY_SCAN_READING,
  executedDocumentName,
  readingAgainstRequirement,
  SCAN_READING_SYSTEM_PROMPT,
  summariseReading,
  type ScanReading,
} from '@/lib/signing/scanReading'

/** The proposal row as the action service returns it to its caller. */
type ProposalRow = Awaited<ReturnType<typeof import('@/lib/actions/server')['createActionProposal']>>['proposal']

/**
 * Scanning in the executed originals.
 *
 * After the signing the paper comes back as scans. Each one is read (what
 * document, signed when, how many witnesses, notarised or not), filed to the
 * matter as a document with its kind recorded, and what the paper shows is
 * proposed as the record of the execution for the attorney to confirm.
 * Filing is a preparation and happens at once; the record is a legal claim
 * and never writes itself.
 */

export const SCAN_IN_MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type ScanInMediaType = (typeof SCAN_IN_MEDIA_TYPES)[number]
/** Claude reads a PDF of up to 32 MB; the firm's scans are a fraction of that. */
export const SCAN_IN_MAX_BYTES = 25 * 1024 * 1024
export const SCAN_IN_MAX_FILES = 10

export function isScanInMediaType(value: string): value is ScanInMediaType {
  return (SCAN_IN_MEDIA_TYPES as readonly string[]).includes(value)
}

/** Read one scan with the model. A failure reads as an empty reading with the cause in its issues. */
export async function readExecutedScan(input: {
  buffer: Buffer
  mediaType: ScanInMediaType
  filename: string
  matterId: string
  actorId: string
}): Promise<ScanReading> {
  try {
    const { callAnthropic } = await import('@/lib/anthropic')
    const { resolveFirmModel } = await import('@/lib/firmModels')
    const data = input.buffer.toString('base64')
    const attachment: Anthropic.ContentBlockParam = input.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: input.mediaType, data } }
    const message = await callAnthropic({
      model: await resolveFirmModel('drafting'),
      max_tokens: 1500,
      system: SCAN_READING_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          attachment,
          { type: 'text', text: `This scan was uploaded as "${input.filename}". Report what the signed document shows. Return only the JSON object.` },
        ],
      }],
    }, { route: 'signing/scan-in', matterId: input.matterId, userId: input.actorId, contextType: 'matter' })
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text).join('').trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return { ...EMPTY_SCAN_READING, issues: ['The scan could not be read.'] }
    return coerceScanReading(JSON.parse(raw.slice(start, end + 1)))
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    console.error('[signing] scan reading failed', { matterId: input.matterId, filename: input.filename, cause })
    return { ...EMPTY_SCAN_READING, issues: [`The scan could not be read: ${cause}`] }
  }
}

export interface FiledScan {
  documentId: string
  name: string
}

/** File a scan to the matter as an executed original, with the kind the reading gave it. */
export async function fileExecutedScan(input: {
  matterId: string
  actorId: string
  buffer: Buffer
  mediaType: ScanInMediaType
  originalName: string
  reading: ScanReading
  clientName: string | null
  now?: Date
}): Promise<FiledScan> {
  const now = input.now ?? new Date()
  const fallbackDate = now.toISOString().slice(0, 10)
  const name = executedDocumentName({ reading: input.reading, clientName: input.clientName, originalName: input.originalName, fallbackDate })
  const r2Key = `matters/${input.matterId}/executed/${now.getTime()}-${safeUploadFilename(name)}`
  await putFileToR2(r2Key, input.buffer, input.mediaType)

  const admin = getAdminClient()
  const row = {
    matter_id: input.matterId,
    r2_key: r2Key,
    name,
    size: input.buffer.byteLength,
    content_type: input.mediaType,
    source: 'firm',
    shared_at: null,
    uploaded_by: input.actorId,
  }
  // `document_kind` arrived with 20270108090000; until it exists the scan is
  // filed without it rather than failing the upload.
  const first = await admin.from('matter_documents').insert({ ...row, document_kind: input.reading.kind ?? null }).select('id').single()
  const { data, error } = first.error && (first.error.code === '42703' || first.error.code === 'PGRST204')
    ? await admin.from('matter_documents').insert(row).select('id').single()
    : first
  if (error) throw new Error(error.message)

  await admin.from('matter_activity').insert({
    matter_id: input.matterId,
    event_type: 'document_uploaded',
    title: `Executed original scanned in: ${name}`,
    detail: summariseReading(input.reading),
    metadata: { document_id: data.id, source: 'scan-in', document_kind: input.reading.kind, signed_on: input.reading.signedOn },
    actor_id: input.actorId,
  })
  return { documentId: String(data.id), name }
}

export interface ScanInResult {
  originalName: string
  document: FiledScan | null
  reading: ScanReading
  notes: string[]
  /** The proposal to record the execution, for the attorney to confirm. Null when the kind could not be read. */
  proposal: ProposalRow | null
  error: string | null
}

export async function runScanIn(input: {
  matterId: string
  actorId: string
  files: Array<{ name: string; mediaType: ScanInMediaType; buffer: Buffer }>
  originalsLocation: string | null
  /** Overrides the date read from every scan when the attorney knows the signing day. */
  signedOn: string | null
  now?: Date
}): Promise<ScanInResult[]> {
  const admin = getAdminClient()
  const { data: pipeline } = await admin.from('v_matter_pipeline').select('client_name').eq('matter_id', input.matterId).maybeSingle()
  const clientName = typeof pipeline?.client_name === 'string' ? pipeline.client_name : null
  const { createActionProposal } = await import('@/lib/actions/server')

  const results: ScanInResult[] = []
  for (const file of input.files) {
    const read = await readExecutedScan({ buffer: file.buffer, mediaType: file.mediaType, filename: file.name, matterId: input.matterId, actorId: input.actorId })
    const reading: ScanReading = input.signedOn ? { ...read, signedOn: input.signedOn } : read
    const result: ScanInResult = { originalName: file.name, document: null, reading, notes: readingAgainstRequirement(reading), proposal: null, error: null }
    try {
      result.document = await fileExecutedScan({
        matterId: input.matterId, actorId: input.actorId, buffer: file.buffer, mediaType: file.mediaType,
        originalName: file.name, reading, clientName, now: input.now,
      })
    } catch (error) {
      result.error = `Could not file the scan: ${error instanceof Error ? error.message : String(error)}`
      results.push(result)
      continue
    }
    // The record is a claim about validity, so it is proposed, never written:
    // the attorney confirms the reading from the card before it is recorded.
    if (reading.kind && result.document) {
      try {
        const created = await createActionProposal({
          actionKey: 'signing.record.executed',
          displaySummary: `Record ${summariseReading(reading)} from the scan ${result.document.name}`,
          referencePayload: {
            matterId: input.matterId,
            documentId: result.document.documentId,
            kind: reading.kind,
            signedOn: reading.signedOn,
            signers: reading.signers,
            witnessCount: reading.witnessCount,
            witnessNames: reading.witnessNames,
            notarized: reading.notarized,
            notaryName: reading.notaryName,
            selfProvingAffidavit: reading.selfProvingAffidavit,
            originalsLocation: input.originalsLocation,
          },
          recordType: 'matter',
          recordId: input.matterId,
          source: 'record',
          idempotencyKey: `scan-in:${result.document.documentId}`,
        }, { id: input.actorId })
        result.proposal = created.proposal
      } catch (error) {
        result.error = `The scan is filed but its record could not be proposed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    results.push(result)
  }
  return results
}
