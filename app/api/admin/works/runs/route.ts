import { NextResponse } from 'next/server'
import { parseOptionalServices } from '@/lib/billing/optionalServices'
import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic, PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { consumeRateLimit } from '@/lib/rateLimit'
import { resolveFirmModel } from '@/lib/firmModels'
import { worksDb } from '@/lib/works/data'
import { canLaunchSkill } from '@/lib/works/run'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { assemblePmpsData } from '@/lib/pmps/assemble'
import { generatePmpsArtifacts } from '@/lib/pmps/generate'
import type { PmpsRunInput } from '@/lib/pmps/types'
import { artifactClientShape, storeRunArtifacts } from '@/lib/works/artifacts'
import { runMetlifeClaim } from '@/lib/metlife/run'

// A run makes a model call and can generate documents; it needs the same
// headroom the chat lanes get, and the same abuse ceiling.
export const maxDuration = 120

/** Matches the admin chat lane: generous enough to work, tight enough to notice abuse. */
const RATE_LIMIT = { bucket: 'works_run', limit: 60, windowSeconds: 600 }

async function loadMatterSnapshot(matterId: string | null) {
  if (!matterId) return null
  const db = worksDb()
  const { data: matter } = await db.from('matters').select('id, name, stage, status, client_intake_id').eq('id', matterId).maybeSingle()
  if (!matter) return null
  const { data: intake } = matter.client_intake_id
    ? await db.from('client_intake').select('*').eq('id', matter.client_intake_id).maybeSingle()
    : { data: null }
  // The snapshot is handed to the model as the matter's context. Spouse,
  // children, and fiduciaries live in contacts — the matching client_intake
  // columns were dropped — so a raw row describes a client with no family.
  const hydratedIntake = intake && matter.client_intake_id
    ? await hydrateIntakeWithContacts(db, intake, matter.client_intake_id).catch(error => {
        console.error('[works run] intake hydrate failed:', error)
        return intake
      })
    : intake
  return { matter, intake: hydratedIntake }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = await consumeRateLimit(RATE_LIMIT, auth.userId)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many runs. Try again shortly.' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    })
  }
  const body = await req.json().catch(() => ({})) as { skillId?: unknown; matterId?: unknown; input?: unknown }
  if (typeof body.skillId !== 'string') return NextResponse.json({ error: 'skillId is required' }, { status: 400 })
  const db = worksDb()
  const { data: skill, error: skillError } = await db.from('work_skills').select('*').eq('id', body.skillId).maybeSingle()
  if (skillError) return NextResponse.json({ error: skillError.message }, { status: 500 })
  if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  const email = auth.user?.email?.trim().toLowerCase() ?? ''
  const shared = skill.owner_id === auth.userId || skill.is_system
    ? true
    : Boolean(email && (await db
        .from('work_skill_shares')
        .select('skill_id')
        .eq('skill_id', skill.id)
        .eq('shared_with_email', email)
        .maybeSingle()).data)
  const launch = canLaunchSkill({ is_active: skill.is_active, is_permitted: shared })
  if (!launch.ok) {
    return launch.reason === 'forbidden'
      ? NextResponse.json({ error: 'This skill is not shared with you' }, { status: 403 })
      : NextResponse.json({ error: 'This skill is inactive' }, { status: 409 })
  }
  const matterId = typeof body.matterId === 'string' ? body.matterId : null
  const snapshot = await loadMatterSnapshot(matterId)
  const requestedInput = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : null
  const inputSnapshot = {
    matterId,
    requestedInput,
    context: snapshot,
    ...(skill.skill_type === 'tabular' ? {
      tabular_review_proposal: {
        title: skill.name,
        columns_config: skill.columns_config ?? [],
        document_ids: Array.isArray(requestedInput?.documentIds) ? requestedInput?.documentIds : [],
      },
    } : {}),
  }
  const { data: run, error: runError } = await db.from('work_runs').insert({
    skill_id: skill.id,
    matter_id: matterId,
    created_by: auth.userId,
    execution_mode: skill.execution_mode,
    status: 'running',
    input_snapshot: inputSnapshot,
    confirmation_state: 'pending',
  }).select('*').single()
  if (runError || !run) return NextResponse.json({ error: runError?.message ?? 'Unable to create run' }, { status: 500 })

  try {
    if (skill.slug === 'prepare-metlife-claim') {
      return await runMetlifeClaim({ db, runId: run.id, matterId, requestedInput, inputSnapshot })
    }
    if (skill.slug === 'prepare-pmps-package') {
      if (!matterId) throw new Error('A matter is required to prepare a PMPS package.')
      const payload = await buildDraftPayload(matterId)
      const { data: details } = await db.from('matter_details').select('legal_plan, flat_fee_amount, fee_quoted_date, optional_services').eq('client_id', matterId).maybeSingle()
      const assembly = assemblePmpsData(payload, (requestedInput ?? {}) as PmpsRunInput, {
        legalPlan: typeof details?.legal_plan === 'string' ? details.legal_plan : null,
        flatFee: typeof details?.flat_fee_amount === 'number' ? details.flat_fee_amount : Number(details?.flat_fee_amount) || null,
        feeQuotedDate: typeof details?.fee_quoted_date === 'string' ? details.fee_quoted_date : null,
        optionalServices: parseOptionalServices(details?.optional_services),
      })
      if (!assembly.data) {
        const message = assembly.preflight.map(issue => issue.message).join('\n')
        const { data: blocked } = await db.from('work_runs').update({
          status: 'failed', error_message: 'PMPS preflight requires additional approved facts.', output_text: message,
          input_snapshot: { ...inputSnapshot, preflight: assembly.preflight }, updated_at: new Date().toISOString(),
        }).eq('id', run.id).select('*').single()
        return NextResponse.json({ error: 'PMPS preflight requires additional approved facts.', preflight: assembly.preflight, run: blocked }, { status: 422 })
      }
      const generated = await generatePmpsArtifacts(assembly.data, assembly.selectedKinds)
      const stored = await storeRunArtifacts(run.id, generated)
      const output = `Generated ${stored.length} isolated PMPS draft${stored.length === 1 ? '' : 's'} for attorney review. Confirm this run to save them to Matter Documents / Intake.`
      const { data: completed, error } = await db.from('work_runs').update({
        status: 'awaiting_confirmation', output_text: output,
        input_snapshot: { ...inputSnapshot, pmps: { planStructure: assembly.data.planStructure, grossEstate: assembly.data.grossEstate, artifactKinds: assembly.selectedKinds } },
        updated_at: new Date().toISOString(),
      }).eq('id', run.id).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ run: completed, artifacts: stored.map(artifactClientShape), preflight: [] }, { status: 201 })
    }
    const model = await resolveFirmModel('assistant')
    const response = await callAnthropic({
      model,
      max_tokens: 4096,
      system: `You are an attorney-support workflow in Cornerstone. Follow the supplied skill instructions exactly. Use only the supplied matter facts. Never invent facts, legal conclusions, dates, names, or documents. Clearly mark missing information as [UNKNOWN]. Produce a draft or analysis for attorney review; do not claim that any matter record was changed.\n\n${PROMPT_INJECTION_GUARDRAIL}\n\nSKILL.md:\n${skill.skill_md}`,
      // The snapshot carries the client's own intake answers and notes. Fence it
      // so instructions typed into an intake field read as content, not commands.
      messages: [{
        role: 'user',
        content: `Run this skill for the following approved context:\n${quoteUserContent('matter-context', JSON.stringify(inputSnapshot, null, 2))}`,
      }],
    }, { route: 'admin/works/run', matterId, userId: auth.userId, contextType: 'matter' })
    const output = response.content.filter(part => part.type === 'text').map(part => (part as { text: string }).text).join('\n').trim()
    const { data: completed, error } = await db.from('work_runs').update({ status: 'awaiting_confirmation', output_text: output, updated_at: new Date().toISOString() }).eq('id', run.id).select('*').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ run: completed }, { status: 201 })
  } catch (error) {
    await db.from('work_runs').update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Workflow failed', updated_at: new Date().toISOString() }).eq('id', run.id)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workflow failed', runId: run.id }, { status: 502 })
  }
}
