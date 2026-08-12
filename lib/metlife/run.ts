import { NextResponse } from 'next/server'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { assembleMetlifeClaim } from '@/lib/metlife/assemble'
import { buildSubmissionRows, generateMetlifeArtifact } from '@/lib/metlife/generate'
import type { MetlifeRunInput } from '@/lib/metlife/types'
import { artifactClientShape, storeRunArtifacts } from '@/lib/works/artifacts'

const DETAIL_COLUMNS =
  'billing_type, legal_plan_member_id, legal_plan_service_start, legal_plan_service_end, work_started_date, work_finished_date'

/**
 * The deterministic half of the Prepare MetLife Claim skill. Mirrors the PMPS
 * branch of the works runner: preflight first, then generate an artifact that
 * stays isolated from the matter until the attorney confirms the run.
 */
export async function runMetlifeClaim(args: {
  // The works runner hands over its untyped admin client; see lib/works/data.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  runId: string
  matterId: string | null
  requestedInput: Record<string, unknown> | null
  inputSnapshot: Record<string, unknown>
}) {
  const { db, runId, matterId, requestedInput, inputSnapshot } = args
  if (!matterId) throw new Error('A matter is required to prepare a MetLife claim.')

  const payload = await buildDraftPayload(matterId)
  const { data: details } = await db.from('matter_details').select(DETAIL_COLUMNS).eq('client_id', matterId).maybeSingle()

  const assembly = assembleMetlifeClaim(payload, {
    billingType: details?.billing_type ?? null,
    memberId: details?.legal_plan_member_id ?? null,
    serviceStart: details?.legal_plan_service_start ?? null,
    serviceEnd: details?.legal_plan_service_end ?? null,
    workStarted: details?.work_started_date ?? null,
    workFinished: details?.work_finished_date ?? null,
  }, (requestedInput ?? {}) as MetlifeRunInput)

  if (!assembly.data) {
    const message = assembly.preflight.map(issue => issue.message).join('\n')
    const { data: blocked } = await db.from('work_runs').update({
      status: 'failed',
      error_message: 'MetLife claim preflight requires additional approved facts.',
      output_text: message,
      input_snapshot: { ...inputSnapshot, preflight: assembly.preflight },
      updated_at: new Date().toISOString(),
    }).eq('id', runId).select('*').single()
    return NextResponse.json({
      error: 'MetLife claim preflight requires additional approved facts.',
      preflight: assembly.preflight,
      run: blocked,
    }, { status: 422 })
  }

  const artifact = await generateMetlifeArtifact(assembly.data)
  const stored = await storeRunArtifacts(runId, [artifact])
  const submissionRows = buildSubmissionRows(assembly.data)
  const total = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(assembly.data.grandTotalCents / 100)
  const output = `Prepared a ${total} MetLife claim with ${submissionRows.length} portal submission${submissionRows.length === 1 ? '' : 's'}. Confirm this run to save the document to Matter Documents and file the claim in the ledger.`

  const { data: completed, error } = await db.from('work_runs').update({
    status: 'awaiting_confirmation',
    output_text: output,
    input_snapshot: {
      ...inputSnapshot,
      metlife: {
        planType: assembly.data.planType,
        grandTotalCents: assembly.data.grandTotalCents,
        realtyTrustCount: assembly.data.realtyTrustCount,
        includeMinorGuardian: assembly.data.includeMinorGuardian,
        submissionRows,
      },
    },
    updated_at: new Date().toISOString(),
  }).eq('id', runId).select('*').single()
  if (error) throw new Error(error.message)

  return NextResponse.json({ run: completed, artifacts: stored.map(artifactClientShape), preflight: [] }, { status: 201 })
}
