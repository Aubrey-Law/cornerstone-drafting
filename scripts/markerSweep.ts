/**
 * Which firm drafts would the share gate refuse, and which fields are to blame?
 *
 *   npm run sweep:markers
 *   npm run sweep:markers -- --matter <id>     # one matter
 *   npm run sweep:markers -- --json            # machine-readable
 *   npm run sweep:markers -- --concurrency 4
 *
 * The gate in `lib/documents/shareGate.ts` refuses one document at a time, at the
 * moment of sharing. That is where a block belongs and a poor place to learn from:
 * each refusal arrives alone, mid-send. This asks the same question of every firm
 * document at once, so the answer arrives as a worklist instead of a surprise.
 *
 * It calls the gate itself rather than re-implementing the scan, so a document
 * listed here is one that would genuinely be refused — and it reads the bytes in
 * R2 rather than the stored `missing_count`, which goes stale whenever a document
 * is fixed outside the app.
 *
 * Read-only. Nothing is written to the database, R2, or the documents.
 */
import { config } from 'dotenv'
import { checkDocumentShareable, type ShareCandidate } from '@/lib/documents/shareGate'
import {
  formatSweepReport,
  summarizeSweep,
  type SweptDocument,
} from '@/lib/documents/markerSweep'
import { parseArgs } from '@/lib/reviewSlice/args'
import { getAdminClient } from '@/lib/supabaseAdmin'

// Run from a shell rather than from Next, so nothing has loaded the environment
// yet. `override: false` means an already-exported variable still wins.
config({ path: '.env.test', override: false, quiet: true })
config({ path: '.env.local', override: false, quiet: true })

const DEFAULT_CONCURRENCY = 6

interface DocumentRow {
  id: string
  matter_id: string
  r2_key: string
  name: string | null
  content_type: string | null
  source: string | null
  missing_count: number | null
  shared_at: string | null
  superseded_at: string | null
}

/** Runs `worker` over `items`, at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function requireEnvironment(): void {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    key => !process.env[key],
  )
  if (missing.length > 0) {
    console.error(
      `Cannot reach the database: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.\n` +
        'Run this from a checkout with .env.local in place.',
    )
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(parsed.error)
    process.exit(1)
  }
  const args = parsed.args
  const asJson = args.json === true
  const matterFilter = typeof args.matter === 'string' ? args.matter : null
  const requested = Number(args.concurrency)
  const concurrency = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_CONCURRENCY

  requireEnvironment()
  const sb = getAdminClient()

  // Everything the gate would scan, which is everything the client did not
  // upload themselves — not `source = 'firm'`. The two differ today (there are
  // `meeting-notes` documents), and filtering to 'firm' would quietly under-report
  // against the very gate this is meant to preview. A null source is included for
  // the same reason: the gate reads it as "not a client upload" and scans it.
  let query = sb
    .from('matter_documents')
    .select('id, matter_id, r2_key, name, content_type, source, missing_count, shared_at, superseded_at')
    .or('source.is.null,source.neq.client')
  if (matterFilter) query = query.eq('matter_id', matterFilter)

  const { data, error } = await query
  if (error) {
    console.error(`Could not list documents: ${error.message}`)
    process.exit(1)
  }
  const rows = (data ?? []) as DocumentRow[]
  if (rows.length === 0) {
    console.log(matterFilter ? 'That matter has no documents to check.' : 'There are no documents to check.')
    return
  }

  // Matter names come from a separate read: matter_documents.matter_id is text
  // with no foreign key, so PostgREST cannot join it to matters.id (uuid).
  const matterLabels = new Map<string, string>()
  const matterIds = [...new Set(rows.map(row => row.matter_id))]
  const { data: matters } = await sb.from('matters').select('id, name, matter_number').in('id', matterIds)
  for (const matter of (matters ?? []) as Array<{ id: string; name: string | null; matter_number: string | null }>) {
    const label = [matter.matter_number, matter.name].filter(Boolean).join(' · ')
    if (label) matterLabels.set(matter.id, label)
  }

  if (!asJson) {
    console.log(`Checking ${rows.length} documents against the share gate…\n`)
  }

  const swept = await mapWithConcurrency(rows, concurrency, async row => {
    const candidate: ShareCandidate = {
      r2_key: row.r2_key,
      name: row.name,
      content_type: row.content_type,
      source: row.source,
      missing_count: row.missing_count,
    }
    const document: SweptDocument = {
      id: row.id,
      name: row.name ?? row.id,
      matterId: row.matter_id,
      matterLabel: matterLabels.get(row.matter_id) ?? null,
      sharedAt: row.shared_at,
      supersededAt: row.superseded_at,
      check: await checkDocumentShareable(candidate),
    }
    return document
  })

  const report = summarizeSweep(swept)
  console.log(asJson ? JSON.stringify(report, null, 2) : formatSweepReport(report))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
