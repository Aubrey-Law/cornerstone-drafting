/**
 * Backfill decisions.trust_details.residual_beneficiary_method from the legacy
 * `distribution_method` column.
 *
 * The design sheet used to write this decision to both homes and they drifted, so
 * some sheets carry the method only on the column. trust_details is now the single
 * written home and the column is read-only legacy; once every sheet that has a
 * method carries it in trust_details, the column and the fallback read in
 * resolveResidualBeneficiaryMethod can both go.
 *
 * Only rows whose column value maps onto a real ResidualBeneficiaryMethod are
 * touched. A row holding something else is reported, not guessed at — which method
 * the attorney intended is not derivable from free text.
 *
 * --clear-unmappable nulls the column on those rows instead. That is a separate,
 * explicit decision: it discards a value rather than moving it, so it is opt-in and
 * only for values that match no option this field has ever offered. Nothing reads
 * them — resolveResidualBeneficiaryMethod already rejects them — so the column is
 * simply claiming a choice that was never made.
 *
 * The write is a compare-and-swap on updated_at, so a concurrent edit from the app
 * makes the backfill skip that row rather than clobber it. It is idempotent: a row
 * that already has the trust_details value is left alone.
 *
 * Usage (reads the hosted credentials from the env files):
 *   set -a; source .env; source .env.local; set +a
 *   npx tsx scripts/backfillResidualBeneficiaryMethod.ts [--apply] [--clear-unmappable]
 *
 * Without --apply it reports what it would do and writes nothing.
 */
import { createClient } from '@supabase/supabase-js'
import { normalizeResidualBeneficiaryMethod } from '../lib/designSheetTrustDetails'

const APPLY = process.argv.includes('--apply')
const CLEAR_UNMAPPABLE = process.argv.includes('--clear-unmappable')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type Candidate = {
  id: string
  updatedAt: string | null
  column: string
  method: string
  decisions: Record<string, unknown>
}

type Unmappable = { id: string; updatedAt: string | null; column: string }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  const admin = createClient(url, key)

  const { data, error } = await admin
    .from('design_sheets')
    .select('id, updated_at, distribution_method, decisions')
  if (error) throw new Error(error.message)

  const candidates: Candidate[] = []
  const unmappable: Unmappable[] = []
  let alreadyCanonical = 0
  let noMethod = 0

  for (const row of data ?? []) {
    const decisions = isRecord(row.decisions) ? row.decisions : {}
    const trustDetails = isRecord(decisions.trust_details) ? decisions.trust_details : {}

    if (normalizeResidualBeneficiaryMethod(trustDetails.residual_beneficiary_method)) {
      alreadyCanonical += 1
      continue
    }
    const column = row.distribution_method
    if (typeof column !== 'string' || column.trim() === '') {
      noMethod += 1
      continue
    }
    const method = normalizeResidualBeneficiaryMethod(column)
    if (!method) {
      unmappable.push({
        id: row.id as string,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
        column,
      })
      continue
    }
    candidates.push({
      id: row.id as string,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      column,
      method,
      decisions,
    })
  }

  console.log(`design sheets: ${data?.length ?? 0}`)
  console.log(`  already canonical: ${alreadyCanonical}`)
  console.log(`  no method set:     ${noMethod}`)
  console.log(`  to backfill:       ${candidates.length}`)
  console.log(`  unmappable:        ${unmappable.length}`)

  if (unmappable.length > 0) {
    console.log('\nColumn values that are not a residual beneficiary method:')
    for (const row of unmappable) console.log(`  ${row.id}  ${JSON.stringify(row.column)}`)
    console.log(CLEAR_UNMAPPABLE
      ? '  --clear-unmappable: these will be nulled. Nothing reads them; the column is'
        + '\n  claiming a choice that was never made.'
      : '  Not touched. Re-run with --clear-unmappable to null them, or set a real'
        + '\n  method in Trust Details if one was intended.')
  }

  if (candidates.length === 0 && !(CLEAR_UNMAPPABLE && unmappable.length > 0)) {
    console.log('\nNothing to do.')
    return
  }

  console.log('\nPlanned writes:')
  for (const row of candidates) {
    console.log(`  ${row.id}  column ${JSON.stringify(row.column)} -> trust_details.residual_beneficiary_method ${JSON.stringify(row.method)}`)
  }
  if (CLEAR_UNMAPPABLE) {
    for (const row of unmappable) {
      console.log(`  ${row.id}  column ${JSON.stringify(row.column)} -> null`)
    }
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  console.log('\nApplying…')
  let written = 0
  let skipped = 0
  for (const row of candidates) {
    const trustDetails = isRecord(row.decisions.trust_details) ? row.decisions.trust_details : {}
    // Merge the one key. Deliberately not setTrustDetails: that materialises every
    // default into the stored blob, and a backfill should change exactly what it says.
    const nextDecisions = {
      ...row.decisions,
      trust_details: { ...trustDetails, residual_beneficiary_method: row.method },
    }

    let query = admin.from('design_sheets').update({ decisions: nextDecisions }).eq('id', row.id)
    if (row.updatedAt) query = query.eq('updated_at', row.updatedAt)

    const { data: updated, error: updateError } = await query.select('id')
    if (updateError) throw new Error(`${row.id}: ${updateError.message}`)
    if (!updated || updated.length === 0) {
      console.log(`  skipped ${row.id} — changed since it was read`)
      skipped += 1
      continue
    }
    console.log(`  wrote ${row.id}`)
    written += 1
  }

  if (CLEAR_UNMAPPABLE) {
    for (const row of unmappable) {
      let query = admin.from('design_sheets').update({ distribution_method: null }).eq('id', row.id)
      if (row.updatedAt) query = query.eq('updated_at', row.updatedAt)

      const { data: updated, error: clearError } = await query.select('id')
      if (clearError) throw new Error(`${row.id}: ${clearError.message}`)
      if (!updated || updated.length === 0) {
        console.log(`  skipped ${row.id} — changed since it was read`)
        skipped += 1
        continue
      }
      console.log(`  cleared ${row.id} (was ${JSON.stringify(row.column)})`)
      written += 1
    }
  }

  console.log(`\nwritten: ${written}  skipped: ${skipped}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
