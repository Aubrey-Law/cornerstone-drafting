import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeDesignPlanType, type DesignPlanType } from '@/lib/designPlanType'
import { IntegrationError } from '@/lib/integrations/errors'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import { normalizeIntakePlanType, type IntakePlanType } from '@/lib/intakePlanType'
import { normalizeIntakeTrack } from '@/lib/intakeTrack'
import { parsePracticeArea, type PracticeAreaCode } from '@/lib/practiceArea'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase, Json } from '@/types/supabase'

type EstatePracticeArea = Extract<PracticeAreaCode, 'EP' | 'EP-LP'>
type MatterType = 'individual' | 'couple'
type EstatePackagePlan =
  | 'individual_trust'
  | 'joint_trust'
  | 'separate_trust'
  | 'will_individual'
  | 'will_couple'
  | 'testamentary_trust_individual'
  | 'testamentary_trust_couple'
  | 'incapacity_individual'
  | 'incapacity_couple'

type PackageKeyInput =
  | { practiceArea: EstatePracticeArea; normalizedPlanType: EstatePackagePlan }
  | { practiceArea: 'CP'; normalizedPlanType: 'college_prep' }

interface MatterRow {
  client_intake_id: string | null
  matter_type: string | null
}

interface DetailsRow {
  practice_area: string | null
}

interface DesignRow {
  plan_type: string | null
  is_joint: boolean | null
  decisions: Json
}

interface IntakeRow {
  plan_type: string | null
  intake_track: string | null
  practice_area: string | null
}

function database(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

function failure(kind: 'attention' | 'retryable', code: string, safeMessage: string) {
  return new IntegrationError({ provider: 'statular', kind, code, safeMessage, retryAfterMs: null })
}

function configurationRequired() {
  return failure('attention', 'configuration_required', 'The Statular document package needs configuration.')
}

function persistenceFailure() {
  return failure('retryable', 'integration_persistence_failed', 'Unable to read Statular package configuration.')
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined
    && (typeof value !== 'string' || value.trim().length > 0)
}

function matterType(value: unknown): MatterType {
  if (value === 'individual' || value === 'couple') return value
  throw configurationRequired()
}

function decisions(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, Json | undefined>
}

export function packageKey(input: PackageKeyInput): string {
  return `${input.practiceArea}:${input.normalizedPlanType}`
}

function estateDesignPlan(
  practiceArea: EstatePracticeArea,
  type: MatterType,
  planType: DesignPlanType,
  isJoint: boolean | null,
): string {
  if (planType === 'pour_over') {
    if (type === 'individual') {
      if (isJoint === true) throw configurationRequired()
      return packageKey({ practiceArea, normalizedPlanType: 'individual_trust' })
    }
    if (typeof isJoint !== 'boolean') throw configurationRequired()
    return packageKey({
      practiceArea,
      normalizedPlanType: isJoint ? 'joint_trust' : 'separate_trust',
    })
  }
  if (planType === 'outright_will') {
    return packageKey({
      practiceArea,
      normalizedPlanType: type === 'couple' ? 'will_couple' : 'will_individual',
    })
  }
  return packageKey({
    practiceArea,
    normalizedPlanType: type === 'couple'
      ? 'testamentary_trust_couple'
      : 'testamentary_trust_individual',
  })
}

function estateIntakePlan(
  practiceArea: EstatePracticeArea,
  type: MatterType,
  planType: IntakePlanType,
): string {
  if (planType === 'joint_rlt') {
    if (type !== 'couple') throw configurationRequired()
    return packageKey({ practiceArea, normalizedPlanType: 'joint_trust' })
  }
  if (planType === 'separate_rlt') {
    if (type !== 'couple') throw configurationRequired()
    return packageKey({ practiceArea, normalizedPlanType: 'separate_trust' })
  }
  if (planType === 'individual_rlt') {
    if (type !== 'individual') throw configurationRequired()
    return packageKey({ practiceArea, normalizedPlanType: 'individual_trust' })
  }
  if (planType === 'will_based') {
    return packageKey({
      practiceArea,
      normalizedPlanType: type === 'couple' ? 'will_couple' : 'will_individual',
    })
  }
  return packageKey({
    practiceArea,
    normalizedPlanType: type === 'couple' ? 'incapacity_couple' : 'incapacity_individual',
  })
}

function practiceArea(primary: unknown, fallback: unknown): PracticeAreaCode {
  const source = present(primary) ? primary : fallback
  if (!present(source)) throw configurationRequired()
  const parsed = parsePracticeArea(source)
  if (!parsed) throw configurationRequired()
  return parsed
}

async function readPackageRows(matterId: string): Promise<{
  matter: MatterRow
  details: DetailsRow | null
  design: DesignRow | null
  intake: IntakeRow | null
} | null> {
  const db = database()
  const { data: matter, error: matterError } = await db.from('matters')
    .select('client_intake_id,matter_type').eq('id', matterId).maybeSingle()
  if (matterError) throw persistenceFailure()
  if (!matter) return null

  const { data: details, error: detailsError } = await db.from('matter_details')
    .select('practice_area').eq('client_id', matterId).maybeSingle()
  if (detailsError) throw persistenceFailure()

  const { data: design, error: designError } = await db.from('design_sheets')
    .select('plan_type,is_joint,decisions').eq('matter_id', matterId)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  if (designError) throw persistenceFailure()

  const intakeId = (matter as MatterRow).client_intake_id
  let intake: IntakeRow | null = null
  if (intakeId) {
    const result = await db.from('client_intake')
      .select('plan_type,intake_track,practice_area').eq('id', intakeId).maybeSingle()
    if (result.error) throw persistenceFailure()
    intake = result.data as IntakeRow | null
  }

  return {
    matter: matter as MatterRow,
    details: details as DetailsRow | null,
    design: design as DesignRow | null,
    intake,
  }
}

export async function resolveStatularPackageKey(matterId: string): Promise<string | null> {
  try {
    const rows = await readPackageRows(matterId)
    if (!rows) return null
    const area = practiceArea(rows.details?.practice_area, rows.intake?.practice_area)

    if (area === 'Probate') throw configurationRequired()
    if (area === 'CP') {
      const designTrack = normalizeIntakeTrack(decisions(rows.design?.decisions ?? {})?.plan_track)
      const intakeTrack = normalizeIntakeTrack(rows.intake?.intake_track)
      if (designTrack !== 'college_prep' && intakeTrack !== 'college_prep') {
        throw configurationRequired()
      }
      return packageKey({ practiceArea: 'CP', normalizedPlanType: 'college_prep' })
    }

    const type = matterType(rows.matter.matter_type)
    if (present(rows.design?.plan_type)) {
      const plan = normalizeDesignPlanType(rows.design?.plan_type)
      if (!plan) throw configurationRequired()
      return estateDesignPlan(area, type, plan, rows.design?.is_joint ?? null)
    }

    if (!present(rows.intake?.plan_type)) throw configurationRequired()
    const plan = normalizeIntakePlanType(rows.intake?.plan_type)
    if (!plan) throw configurationRequired()
    return estateIntakePlan(area, type, plan)
  } catch (error) {
    if (error instanceof IntegrationError && error.provider === 'statular') throw error
    throw persistenceFailure()
  }
}

export async function resolveStatularDocId(matterId: string): Promise<number> {
  const key = await resolveStatularPackageKey(matterId)
  if (!key) throw configurationRequired()
  try {
    const docId = (await getIntegrationSettings()).statularDocIdMap[key]
    if (docId === undefined) throw configurationRequired()
    return docId
  } catch (error) {
    if (error instanceof IntegrationError && error.provider === 'statular') throw error
    if (error instanceof Error && error.message !== 'Unable to read integration settings.') {
      throw configurationRequired()
    }
    throw persistenceFailure()
  }
}
