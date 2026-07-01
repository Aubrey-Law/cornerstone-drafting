import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getBearerToken, requireAdmin } from '@/lib/apiAuth'
import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { generateDocuments } from '@/lib/drafting/generateDocuments'
import { getRequestOrigin } from '@/lib/requestOrigin'
import { buildDraftDocumentName, titleFromOutputSlug } from '@/lib/estateGenerator/draftDocumentName'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'
import {
  buildDraftDownloadArtifacts,
  draftDownloadZipFilename,
  encodeDraftDownloadMeta,
} from '@/lib/drafting/buildDraftDownloadZip'
import { selectSupersededDraftIds } from '@/lib/drafting/supersede'

// Per-document marker report returned to the drafting UI. A non-zero markerCount
// means the document still contains `[TODO:`, `[[ MISSING ]]`, or leftover
// template syntax and must not be promoted to a client-visible folder.
type DocumentReport = {
  name: string
  todoCount: number
  markerCount: number
  unresolved: string[]
  missingFields: string[]
}

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type DraftDocType =
  | 'joint_revocable_trust'
  | 'individual_revocable_trust'
  | 'pour_over_will'
  | 'pour_over_wills_x2'
  | 'will_individual'
  | 'wills_x2'
  | 'will_testamentary_trust'
  | 'wills_testamentary_x2'
  | 'dpoa_individual'
  | 'dpoa_x2'
  | 'hcp_individual'
  | 'hcp_x2'
  | 'hipaa_individual'
  | 'hipaa_x2'
  | 'ahd'
  | 'parental_guardian_appointment'
  | 'personal_property_memo'
  | 'temp_delegation'

// getBaseUrl() is used by generateFallbackFiles for the /api/drafting calls.
// NEXT_PUBLIC_APP_URL is no longer needed for the primary generate path (now a direct
// function call), but fallback per-doc drafting still needs an absolute app URL.
function getBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.NODE_ENV !== 'production') return getRequestOrigin(req)
  throw new Error(
    'NEXT_PUBLIC_APP_URL must be set in production for fallback draft generation requests'
  )
}

function requireConfiguredEnv(name: string): string {
  const value = process.env[name]
  if (!value || /^<.*>$/.test(value.trim())) {
    throw new Error(`${name} is not configured`)
  }
  return value
}

function assertR2Configured() {
  requireConfiguredEnv('R2_ACCOUNT_ID')
  requireConfiguredEnv('R2_ACCESS_KEY_ID')
  requireConfiguredEnv('R2_SECRET_ACCESS_KEY')
  requireConfiguredEnv('R2_BUCKET_NAME')
}

function deriveDocTypes(payload: DraftPayload): DraftDocType[] {
  const docTypes: DraftDocType[] = []
  const spouseDocs = payload.documents.spouse_docs

  if (payload.documents.include_trust) {
    docTypes.push(payload.matter.type === 'married_joint' ? 'joint_revocable_trust' : 'individual_revocable_trust')
  }
  if (payload.documents.include_pour_over_will) {
    docTypes.push(spouseDocs ? 'pour_over_wills_x2' : 'pour_over_will')
  }
  if (payload.documents.include_simple_will) {
    docTypes.push(spouseDocs ? 'wills_x2' : 'will_individual')
  }
  if (payload.documents.include_testamentary_trust_will) {
    docTypes.push(spouseDocs ? 'wills_testamentary_x2' : 'will_testamentary_trust')
  }
  if (payload.documents.include_dpoa) {
    docTypes.push(spouseDocs ? 'dpoa_x2' : 'dpoa_individual')
  }
  if (payload.documents.include_hcp) {
    docTypes.push(spouseDocs ? 'hcp_x2' : 'hcp_individual')
  }
  if (payload.documents.include_hipaa) {
    docTypes.push(spouseDocs ? 'hipaa_x2' : 'hipaa_individual')
  }
  if (payload.documents.include_ahd) {
    docTypes.push('ahd')
  }
  if (payload.documents.include_parental_appointment) {
    docTypes.push('parental_guardian_appointment')
  }
  if (payload.documents.include_ppm) {
    docTypes.push('personal_property_memo')
  }
  if (payload.documents.include_temp_delegation) {
    docTypes.push('temp_delegation')
  }

  return docTypes
}

function normalizeDraftWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings.map(warning => warning.trim()).filter(Boolean)))
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function warningsFromGenerateResult(generateResult: unknown): string[] {
  if (!generateResult || typeof generateResult !== 'object') return []
  return normalizeDraftWarnings(stringArrayValue((generateResult as { warnings?: unknown }).warnings))
}

function missingFromGenerateResult(generateResult: unknown): string[] {
  if (!generateResult || typeof generateResult !== 'object') return []
  return normalizeDraftWarnings(stringArrayValue((generateResult as { missing?: unknown }).missing))
}

function draftCoverageWarnings(payload: DraftPayload): string[] {
  const warnings: string[] = []

  if (payload.documents.include_testamentary_trust_will) {
    warnings.push(
      'Testamentary trust will drafting is coverage-limited. Review trustee, beneficiary, age-distribution, and trust-protector provisions before sharing.'
    )
  }

  return warnings
}

function mergeDraftWarnings(...groups: string[][]): string[] {
  return normalizeDraftWarnings(groups.flat())
}

type EstateGeneratorEngine = 'node' | 'supabase'

function estateGeneratorEngine(): EstateGeneratorEngine {
  const engine = process.env.ESTATE_GENERATOR_ENGINE?.trim().toLowerCase()
  if (engine === 'supabase' || engine === 'typescript') return 'supabase'
  return 'node'
}

async function generateFallbackFiles(
  req: NextRequest,
  matterRef: string,
  token: string,
  payload: DraftPayload,
): Promise<Array<{ filename: string; buffer: Buffer }>> {
  const baseUrl = getBaseUrl(req)
  const docTypes = deriveDocTypes(payload)
  const files: Array<{ filename: string; buffer: Buffer }> = []

  for (const docType of docTypes) {
    const draftRes = await fetch(`${baseUrl}/api/drafting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ matter_id: matterRef, doc_type: docType }),
    })

    const draftRaw = await draftRes.text()
    const draftBody = tryParseJson<{ error?: string; text?: string; label?: string }>(draftRaw)
    if (!draftRes.ok || !draftBody.text) {
      throw new Error(draftBody.error ?? (draftRaw.slice(0, 300) || `Failed to draft ${docType}`))
    }

    const docxRes = await fetch(`${baseUrl}/api/drafting/docx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: draftBody.text,
        matter_id: matterRef,
        doc_type: docType,
        label: draftBody.label ?? docType,
      }),
    })

    if (!docxRes.ok) {
      const docxRaw = await docxRes.text()
      const docxBody = tryParseJson<{ error?: string }>(docxRaw)
      throw new Error(docxBody.error ?? (docxRaw.slice(0, 300) || `Failed to build DOCX for ${docType}`))
    }

    const disposition = docxRes.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename=\"([^\"]+)\"/)
    const filename = match?.[1] ?? `${docType}.docx`

    files.push({
      filename,
      buffer: Buffer.from(await docxRes.arrayBuffer()),
    })
  }

  return files
}

function tryParseJson<T extends object>(raw: string): Partial<T> {
  try {
    return JSON.parse(raw) as T
  } catch {
    return {}
  }
}


type DraftDeliveryMode = 'save' | 'download'

function parseDeliveryMode(value: unknown): DraftDeliveryMode {
  return value === 'download' ? 'download' : 'save'
}

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  // Step 1: Auth guard
  const { err, user } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = getBearerToken(req)

  // Step 2: Extract matter ID
  const { id: matterId } = await params

  // Optional: a subset of document slugs (matching the preflight `filename`s) to
  // save. When omitted or empty, every generated document is saved.
  const rawBody = await req.text().catch(() => '')
  const body = rawBody ? tryParseJson<{ documents?: unknown; mode?: unknown }>(rawBody) : {}
  const deliveryMode = parseDeliveryMode(body.mode)
  const requestedDocuments = Array.isArray(body.documents)
    ? body.documents.filter((slug): slug is string => typeof slug === 'string' && slug.trim().length > 0)
    : []
  const selectedDocuments = requestedDocuments.length > 0 ? new Set(requestedDocuments) : null

  try {
    const canonicalMatterId = await resolveMatterId(matterId)

    // Step 3: Build payload
    let payload: DraftPayload
    try {
      payload = await buildDraftPayload(canonicalMatterId)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }

    // Step 4: Guard — design sheet required
    if (!payload.design_sheet_id) {
      return NextResponse.json(
        {
          error:
            'No design sheet found for this matter. Complete the design sheet before drafting.',
        },
        { status: 422 }
      )
    }

    // Step 4: Generate documents via direct function call (no internal HTTP round-trip)
    let draftWarnings = draftCoverageWarnings(payload)
    let draftMissing: string[] = []
    const engine = estateGeneratorEngine()
    const usingEstateGenerator = engine !== 'supabase'
    const admin = getAdminClient()
    let generateResult
    // Which generator actually produced the files, recorded per document for
    // provenance. Starts at the configured engine and is corrected when the Node
    // path defers to the Supabase generator or the per-document Python fallback.
    let generationEngine: 'node' | 'supabase' | 'python_fallback' = engine
    if (engine === 'node') {
      const nodeGenerateResult = await import('@/lib/estateGenerator/node/generate').then(mod => mod.generateEstatePlanDocumentsNode(payload))
      if (!nodeGenerateResult.ok && nodeGenerateResult.status === 501) {
        generationEngine = 'supabase'
        generateResult = await import('@/lib/estateGenerator/runEstateGenerator').then(mod => mod.generateEstatePlanDocuments(payload))
      } else {
        generateResult = nodeGenerateResult
      }
    } else {
      generateResult = await generateDocuments(admin, payload.design_sheet_id, user.id, payload.documents)
    }
    draftWarnings = mergeDraftWarnings(draftWarnings, warningsFromGenerateResult(generateResult))
    draftMissing = missingFromGenerateResult(generateResult)

    let generatedFiles: Array<{
      filename: string
      buffer: Buffer
      title?: string
      owner?: string | null
    }> = []

    if (generateResult.ok) {
      generatedFiles = generateResult.files.map(f => {
        // Node generator files carry friendly title + owner; the Python/Supabase
        // fallbacks return only name + buffer.
        const meta = f as { title?: string; owner?: string | null }
        return { filename: f.name, buffer: f.buffer, title: meta.title, owner: meta.owner }
      })
    } else {
      if (usingEstateGenerator) {
        return NextResponse.json(
          {
            error: generateResult.error ?? 'Document generation failed',
            missing: draftMissing,
            warnings: draftWarnings,
          },
          { status: generateResult.status }
        )
      }

      // Bulk generate failed — fall back to per-doc drafting only if the
      // payload itself has docs to draft. Otherwise propagate the error.
      const derivedDocTypes = deriveDocTypes(payload)
      if (derivedDocTypes.length > 0) {
        if (!token) {
          return NextResponse.json(
            { error: 'Draft fallback requires an active admin session. Refresh and try again.' },
            { status: 401 }
          )
        }
        generationEngine = 'python_fallback'
        generatedFiles = await generateFallbackFiles(req, canonicalMatterId, token, payload)
      } else {
        return NextResponse.json(
          {
            error: generateResult.error ?? 'Document generation failed',
            missing: draftMissing,
            warnings: draftWarnings,
          },
          { status: generateResult.status }
        )
      }
    }

    // Save only the documents the attorney selected (if any).
    if (selectedDocuments) {
      const filtered = generatedFiles.filter(file => selectedDocuments.has(file.filename))
      if (filtered.length === 0) {
        return NextResponse.json(
          {
            error: 'None of the selected documents were available to generate.',
            missing: draftMissing,
            warnings: draftWarnings,
          },
          { status: 422 }
        )
      }
      generatedFiles = filtered
    }

    if (generatedFiles.length === 0) {
      return NextResponse.json(
        {
          error: 'No files found in generated archive',
          missing: draftMissing,
          warnings: draftWarnings,
        },
        { status: 422 }
      )
    }

    if (deliveryMode === 'download') {
      const { zipBuffer, meta } = buildDraftDownloadArtifacts(generatedFiles, payload)
      const downloadMeta = encodeDraftDownloadMeta({
        ...meta,
        missing: draftMissing,
        warnings: draftWarnings,
      })
      const zipFilename = draftDownloadZipFilename(payload.client.full_name)

      return new Response(zipBuffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipFilename}"`,
          'X-Draft-Meta': downloadMeta,
        },
      })
    }

    // Step 5: Upload each file to R2 and register in matter_documents
    assertR2Configured()
    const r2 = getR2Client()
    const uploadedFilenames: string[] = []
    const documentReports: DocumentReport[] = []

    // One id groups every document from this run; used to supersede prior runs
    // and to attribute provenance per document.
    const generationId = randomUUID()

    // Snapshot the current (non-superseded) drafts before inserting this run's
    // rows so we can supersede the ones this run replaces. Captured up front so
    // the just-inserted rows aren't considered, and so pre-migration rows with a
    // null generation_id are still eligible.
    const { data: priorDraftRows } = await admin
      .from('matter_documents')
      .select('id, name')
      .eq('matter_id', canonicalMatterId)
      .eq('folder', 'draft')
      .is('superseded_at', null)
    const priorDrafts = (priorDraftRows ?? []) as Array<{ id: string; name: string }>

    // Client-facing draft name: YYYY-MM-DD_Owner Name_Document Title.docx.
    // Date is the generation date in the firm's timezone (Massachusetts/Eastern).
    const generationDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

    for (const file of generatedFiles) {
      const documentName = buildDraftDocumentName({
        date: generationDate,
        // Fall back to the primary client's name when a file carries no owner
        // (e.g. Python fallback or per-document drafting).
        owner: file.owner ?? payload.client.full_name ?? null,
        title: file.title ?? titleFromOutputSlug(file.filename),
      })

      const timestamp = Date.now()
      const safeFilename = documentName.replace(/[^a-zA-Z0-9._-]/g, '_')
      const r2Key = `matters/${canonicalMatterId}/draft/${timestamp}-${safeFilename}`

      // Scan the final DOCX for unresolved markers before it leaves the server.
      // Engine-agnostic, so it catches `[TODO:` clause text from the Python
      // fallback, `[[ MISSING ]]` holes, and leftover `{{ }}` template syntax
      // regardless of which generator produced the buffer.
      const scan = scanDocxBufferForMarkers(file.buffer)
      documentReports.push({
        name: documentName,
        todoCount: scan.todoCount,
        markerCount: scan.markerCount,
        unresolved: scan.unresolved,
        missingFields: scan.missingFields,
      })

      // 5a: Get presigned upload URL
      const uploadUrl = await getSignedUrl(
        r2,
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: r2Key,
          ContentType: DOCX_CONTENT_TYPE,
        }),
        { expiresIn: 300 }
      )

      // 5b: Upload buffer to R2
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file.buffer,
        headers: { 'Content-Type': DOCX_CONTENT_TYPE },
      })

      if (!putRes.ok) {
        throw new Error(
          `R2 upload failed for ${documentName}: ${putRes.status} ${putRes.statusText}`
        )
      }

      // 5c: Register in matter_documents
      const { error: insertErr } = await admin.from('matter_documents').insert({
        matter_id: canonicalMatterId,
        r2_key: r2Key,
        name: documentName,
        size: file.buffer.length,
        content_type: DOCX_CONTENT_TYPE,
        folder: 'draft',
        folder_id: null,
        uploaded_by: user.id,
        generation_id: generationId,
        generation_engine: generationEngine,
        marker_count: scan.markerCount,
        missing_count: scan.missingFields.length,
      })

      if (insertErr) {
        console.error('[draft route] matter_documents insert error', canonicalMatterId, insertErr)
        throw new Error(`Failed to register document "${documentName}": ${insertErr.message}`)
      }

      uploadedFilenames.push(documentName)
    }

    // Step 5d: Supersede the prior drafts this run replaced (files stay in R2 —
    // audit requirement). A full-set regeneration (`selectedDocuments` null)
    // replaces every prior draft; a subset only supersedes the titles it
    // regenerated, leaving untouched documents active.
    const supersededIds = selectSupersededDraftIds({
      priorDrafts,
      regeneratedNames: uploadedFilenames,
      fullSet: selectedDocuments === null,
    })
    if (supersededIds.length > 0) {
      const { error: supersedeErr } = await admin
        .from('matter_documents')
        .update({ superseded_at: new Date().toISOString() })
        .in('id', supersededIds)
      if (supersedeErr) {
        // Non-fatal: the new drafts are saved; stale rows just remain visible.
        console.error('[draft route] supersede error', canonicalMatterId, supersedeErr)
      }
    }

    // Step 6: Drafts stay internal until the attorney moves finished files to Review.
    const { error: stageErr } = await admin
      .from('matters')
      .update({ stage: 'drafting' })
      .eq('id', canonicalMatterId)

    if (stageErr) {
      // Non-fatal: documents were generated and registered; log and continue
      console.error('[draft route] stage update error', canonicalMatterId, stageErr)
    }

    // Step 7: Return success. `documentReports` carries per-document marker
    // counts; `hasBlockingMarkers` is the loud signal the UI uses to warn that a
    // draft is not ready to share. (The hard promote block lands in WP3.)
    const hasBlockingMarkers = documentReports.some(report => report.markerCount > 0)
    return NextResponse.json({
      success: true,
      documents: uploadedFilenames,
      documentReports,
      hasBlockingMarkers,
      generationId,
      generationEngine,
      matter_id: canonicalMatterId,
      stage: 'drafting',
      missing: draftMissing,
      warnings: draftWarnings,
    })
  } catch (e) {
    console.error('[draft route]', matterId, e)
    return NextResponse.json(
      { error: 'Draft generation failed', detail: (e as Error).message },
      { status: 500 }
    )
  }
}
