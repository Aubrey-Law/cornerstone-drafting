import { getAdminClient } from '@/lib/supabaseAdmin'
import { reconcileFieldValues, type FieldConsistencyRow } from '@/lib/fieldConsistency/reconcile'
import {
  citizenshipDesignLabel,
  normalizeCitizenshipStatus,
} from '@/lib/sharedFields'

async function main() {
  const admin = getAdminClient()
  const includeOverrides = process.argv.includes('--include-overrides')
  const showDetails = process.argv.includes('--details')
  const { data: matters, error } = await admin
    .from('matters')
    .select('id, client_intake_id, matter_type')
    .eq('relationship_status', 'hired')
  if (error) throw new Error(error.message)

  const rows: FieldConsistencyRow[] = []
  const unresolvedMatterTypes: string[] = []
  for (const matter of matters ?? []) {
    if (matter.matter_type !== 'individual' && matter.matter_type !== 'couple') {
      unresolvedMatterTypes.push(matter.id)
    }
    const [{ data: intake }, { data: sheet }] = await Promise.all([
      admin.from('client_intake').select(
        'first_name, middle_name, last_name, address_line1, city, state, zip, citizenship_status, is_us_citizen',
      ).eq('id', matter.client_intake_id).maybeSingle(),
      admin.from('design_sheets').select(
        'client_name, street, city, state, zip, client_citizenship, overrides',
      ).eq('matter_id', matter.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (!intake || !sheet) continue
    const clientName = [intake.first_name, intake.middle_name, intake.last_name]
      .filter(Boolean).join(' ')
    const citizenship = citizenshipDesignLabel(normalizeCitizenshipStatus(
      intake.citizenship_status,
      intake.is_us_citizen,
    ))
    rows.push(...reconcileFieldValues({
      matterId: matter.id,
      sources: {
        client_name: clientName,
        street: intake.address_line1,
        city: intake.city,
        state: intake.state,
        zip: intake.zip,
        client_citizenship: citizenship,
      },
      design: {
        client_name: sheet.client_name,
        street: sheet.street,
        city: sheet.city,
        state: sheet.state,
        zip: sheet.zip,
        client_citizenship: sheet.client_citizenship,
      },
      overrides: sheet.overrides as Record<string, unknown> | null,
      includeOverrides,
    }))
  }

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.field] = (acc[row.field] ?? 0) + 1
    return acc
  }, {})
  console.log(JSON.stringify({
    mattersReviewed: matters?.length ?? 0,
    unresolvedMatterTypes: unresolvedMatterTypes.length,
    unresolvedMatterTypeIds: showDetails ? unresolvedMatterTypes : undefined,
    differences: rows.length,
    counts,
  }, null, 2))
  if (showDetails) console.log(JSON.stringify(rows, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
