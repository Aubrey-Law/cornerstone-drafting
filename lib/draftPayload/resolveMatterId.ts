import { getAdminClient } from '@/lib/supabaseAdmin'

export async function resolveMatterId(inputId: string, admin = getAdminClient()): Promise<string> {
  const { data: matter } = await admin
    .from('matters')
    .select('id')
    .eq('id', inputId)
    .eq('relationship_status', 'hired')
    .maybeSingle()

  if (matter?.id) return matter.id

  const { data: numberedMatter } = await admin
    .from('matters')
    .select('id')
    .eq('matter_number', inputId)
    .eq('relationship_status', 'hired')
    .maybeSingle()

  if (numberedMatter?.id) return numberedMatter.id

  const { data: sheet } = await admin
    .from('design_sheets')
    .select('matter_id')
    .eq('id', inputId)
    .maybeSingle()

  if (sheet?.matter_id) return sheet.matter_id as string

  const { data: legacySheet } = await admin
    .from('design_sheets')
    .select('client_intake_id')
    .eq('matter_id', inputId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (legacySheet?.client_intake_id) {
    const { data: canonicalMatter } = await admin
      .from('matters')
      .select('id')
      .eq('client_intake_id', legacySheet.client_intake_id)
      .eq('relationship_status', 'hired')
      .maybeSingle()

    if (canonicalMatter?.id) return canonicalMatter.id
  }

  const { data: intakeMatter } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', inputId)
    .eq('relationship_status', 'hired')
    .maybeSingle()

  if (intakeMatter?.id) return intakeMatter.id

  const { data: legacyIntake } = await admin
    .from('client_intake')
    .select('id')
    .eq('matter_id', inputId)
    .maybeSingle()

  if (legacyIntake?.id) {
    const { data: matterFromLegacyIntake } = await admin
      .from('matters')
      .select('id')
      .eq('client_intake_id', legacyIntake.id)
      .eq('relationship_status', 'hired')
      .maybeSingle()

    if (matterFromLegacyIntake?.id) return matterFromLegacyIntake.id
  }

  return inputId
}
