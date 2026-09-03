/**
 * Run a review playbook against a document, standalone:
 *
 *   npm run review:slice -- --file ~/drafts/smith-trust.pdf
 *   npm run review:slice -- --file draft.docx --playbook tools/workflows/review/ma-trust-third-party-draft.json
 *   npm run review:slice -- --file draft.docx --redline /tmp/smith-trust-marked.docx
 *   npm run review:slice -- --file draft.pdf --layer-only
 *
 * This exists for one job the automated suite cannot do. Nothing in the tests
 * talks to a model, so nothing in the tests can answer the question this whole
 * phase is a gate for: **what share of a real model's citations survive
 * verification against a real document?**
 *
 * Read the "unverified" count below as the finding. If it is high, the answer is
 * to change the prompting or how the document is presented — never to loosen the
 * verifier. A citation model that quietly accepts near-misses is worse than none,
 * because it manufactures confident claims that look checkable and are wrong.
 *
 * Reads a file from disk and touches no matter, so it can be pointed at an
 * opposing-counsel draft before anything about it is stored.
 */
import { config } from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { applyTrackedEditsAtOffsets } from '@aubrey-law/drafting-engine'
import { buildDocxTextLayer, citationToParagraphOffsets } from '@/lib/textLayer/docx'
import { buildPdfTextLayer } from '@/lib/textLayer/pdf'
import { exportableFindings, runReviewPlaybook } from '@/lib/reviewSlice/runReview'
import { reviewPlaybookSchema, type ReviewPlaybook } from '@/lib/reviewSlice/types'
import type { TextLayer } from '@/lib/textLayer/types'

// Run from a shell rather than from Next, so nothing has loaded the environment
// yet — without this the Anthropic SDK finds no ANTHROPIC_API_KEY and the first
// rule dies on an auth error. Same shape as scripts/checkMatterContactsConsistency.ts:
// `override: false` means an already-exported variable still wins, so a caller can
// point this at a different key without editing a file.
// `quiet` because this script's stdout is a report a person reads; dotenv's
// "injected env" banners would sit above the findings for no benefit.
config({ path: '.env.test', override: false, quiet: true })
config({ path: '.env.local', override: false, quiet: true })

const DEFAULT_PLAYBOOK = 'tools/workflows/review/ma-trust-third-party-draft.json'

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const match = argv[i].match(/^--([a-z-]+)$/)
    if (!match) {
      console.error(`Unexpected argument: ${argv[i]}`)
      process.exit(2)
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      args[match[1]] = true
    } else {
      args[match[1]] = value
      i += 1
    }
  }
  return args
}

async function buildLayer(file: string): Promise<TextLayer> {
  const bytes = fs.readFileSync(file)
  const extension = path.extname(file).toLowerCase()
  if (extension === '.pdf') return buildPdfTextLayer(bytes)
  if (extension === '.docx') return buildDocxTextLayer(bytes)
  console.error(`Unsupported file type "${extension}". Give a .pdf or a .docx.`)
  process.exit(2)
}

function loadPlaybook(file: string): ReviewPlaybook {
  const parsed = reviewPlaybookSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!parsed.success) {
    console.error(`Playbook ${file} is not valid:\n${parsed.error.message}`)
    process.exit(2)
  }
  return parsed.data
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const file = typeof args.file === 'string' ? args.file : null
  if (!file) {
    console.error('Usage: npm run review:slice -- --file <document.pdf|document.docx>')
    process.exit(2)
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`)
    process.exit(2)
  }

  const layer = await buildLayer(file)

  console.log(`${path.basename(file)}`)
  console.log(
    `  ${layer.sourceKind} · ${layer.status} · ${layer.blocks.length} blocks · ` +
      `${layer.text.length} characters${layer.pageCount ? ` · ${layer.pageCount} pages` : ''}`,
  )

  if (layer.status === 'no_text') {
    console.error(
      '\nThis document has no text layer — almost certainly a scan. There is nothing to cite,\n' +
        'and reviewing it would produce findings about nothing. Supply a text PDF or the DOCX.',
    )
    process.exit(1)
  }

  if (args['layer-only'] === true) {
    for (const block of layer.blocks) {
      const page = block.page === null ? '' : ` p${block.page}`
      console.log(`\n[¶ ${block.index}${page}] ${block.text}`)
    }
    return
  }

  const playbook = loadPlaybook(
    typeof args.playbook === 'string' ? args.playbook : DEFAULT_PLAYBOOK,
  )
  console.log(`\n${playbook.title} (v${playbook.version}, ${playbook.rules.length} rules)\n`)

  const result = await runReviewPlaybook(layer, playbook, {
    model: typeof args.model === 'string' ? args.model : undefined,
  })

  let verified = 0
  let unverified = 0

  for (const finding of result.findings) {
    const rule = playbook.rules.find(r => r.number === finding.ruleNumber)
    console.log(`Rule ${finding.ruleNumber} — ${finding.outcome.toUpperCase()}${finding.severity ? ` (${finding.severity})` : ''}`)
    console.log(`  ${rule?.statement.split('.')[0] ?? ''}.`)
    console.log(`  ${finding.rationale}`)

    if (finding.citation) {
      verified += 1
      const at = finding.citation.page === null
        ? `¶ ${finding.citation.blockIndex}`
        : `p${finding.citation.page}, ¶ ${finding.citation.blockIndex}`
      console.log(`  ✓ cited at ${at} [${finding.citation.charStart}–${finding.citation.charEnd}]`)
      console.log(`    “${finding.citation.quote}”`)
    } else if (finding.citationRefusal) {
      unverified += 1
      console.log(`  ✗ citation rejected: ${finding.citationRefusal}`)
    }

    if (finding.proposedLanguage) console.log(`  → ${finding.proposedLanguage}`)
    console.log()
  }

  for (const failure of result.failures) {
    console.log(`Rule ${failure.ruleNumber} — CALL FAILED: ${failure.reason}`)
  }

  console.log(
    `${result.findings.length} findings · ${verified} cited · ${unverified} citations rejected · ` +
      `${result.failures.length} rules failed`,
  )

  const redlineOut = typeof args.redline === 'string' ? args.redline : null
  if (!redlineOut) return

  if (layer.sourceKind !== 'docx') {
    console.error('\n--redline needs the .docx: tracked changes are written into the document itself.')
    process.exit(2)
  }

  const exportable = exportableFindings(result)
  if (exportable.length === 0) {
    console.log('\nNothing to redline: no deviation is both cited and carries replacement text.')
    return
  }

  const edits = exportable.flatMap(finding => {
    const offsets = citationToParagraphOffsets(
      layer,
      finding.citation!.charStart,
      finding.citation!.charEnd,
    )
    // A citation spanning a paragraph boundary cannot be marked up as one
    // change. Declining is the honest answer; redlining part of it is not.
    if (!offsets) {
      console.log(`  (rule ${finding.ruleNumber} spans paragraphs — not redlined)`)
      return []
    }
    return [{ ...offsets, replace: finding.proposedLanguage!, reason: `Rule ${finding.ruleNumber}` }]
  })

  const applied = await applyTrackedEditsAtOffsets(fs.readFileSync(file), edits)
  fs.writeFileSync(redlineOut, applied.bytes)
  console.log(`\nWrote ${applied.changes.length} tracked changes to ${redlineOut}`)
  for (const error of applied.errors) {
    console.log(`  edit ${error.index} not applied: ${error.reason}`)
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
