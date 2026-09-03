/**
 * The golden-document corpus: every package rendered from its example payload,
 * fingerprinted by content, with the attorney's approval recorded alongside.
 *
 *   npm run corpus:check                 compare current output to the manifest
 *   npm run corpus:update -- --reason "" rewrite the manifest, deliberately
 *   npm run corpus:list                  show what is approved and what is not
 *
 * Why this exists. Scope-reduction task 8.5.2 asks for templates versioned
 * atomically with their expected output — "SHA/provenance manifests,
 * attorney-approved golden documents". Until now the equivalent check lived in
 * throwaway shell scripts, which meant every drafting change was verified by
 * tooling that did not survive the session that wrote it.
 *
 * What the approval status buys. A hash change on an `unreviewed` document is
 * churn. A hash change on an `approved` one means output an attorney signed off
 * on has changed, which is a different and louder event. `--check` reports them
 * separately and fails on the second even when the first is expected.
 */
import fs from 'node:fs'
import path from 'node:path'
import { generateNodeEstatePackage, bundledTemplateResolver } from '@/lib/estateGenerator/node/generate'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import { DEFAULT_STYLE_SET } from '@aubrey-law/drafting-engine/styleSets/defaults'
import { documentContentHash } from '@/lib/drafting/documentContentHash'
import type { NodeEstateData, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { findExamplePath, listEstatePackageNames } from './estateExamples'

type ApprovalStatus = 'unreviewed' | 'approved'

interface CorpusEntry {
  package: string
  document: string
  title: string
  contentHash: string
  approval: { status: ApprovalStatus; by?: string; at?: string; note?: string }
}

interface CorpusManifest {
  version: 1
  note: string
  updatedAt: string
  updatedReason: string
  documents: CorpusEntry[]
}

const root = resolveNodeEstateGeneratorRoot()
const MANIFEST = path.join(root, 'corpus', 'manifest.json')

function readManifest(): CorpusManifest | null {
  if (!fs.existsSync(MANIFEST)) return null
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as CorpusManifest
}

const key = (e: { package: string; document: string }) => `${e.package}/${e.document}`

/** Render every package that has an example payload, newest output only. */
async function renderAll(): Promise<{ entries: Omit<CorpusEntry, 'approval'>[]; skipped: string[]; failed: string[] }> {
  const entries: Omit<CorpusEntry, 'approval'>[] = []
  const skipped: string[] = []
  const failed: string[] = []

  for (const packageName of listEstatePackageNames(root)) {
    const examplePath = findExamplePath(root, packageName)
    if (!examplePath) { skipped.push(packageName); continue }

    const data = JSON.parse(fs.readFileSync(examplePath, 'utf8')) as NodeEstateData
    const result = await generateNodeEstatePackage({
      data,
      packageName: packageName as NodeEstatePackageName,
      state: 'MA',
      allowDraft: true,
      // Bundled templates and the built-in sweep: the corpus fingerprints what
      // the repository produces, not what one database happens to hold.
      templateResolver: bundledTemplateResolver,
      styleSet: DEFAULT_STYLE_SET,
    })
    if (!result.ok) { failed.push(`${packageName}: ${result.error}`); continue }

    for (const file of result.files) {
      entries.push({
        package: packageName,
        document: file.name,
        title: file.title,
        contentHash: documentContentHash(file.buffer),
      })
    }
  }
  entries.sort((a, b) => key(a).localeCompare(key(b)))
  return { entries, skipped, failed }
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function check(): Promise<number> {
  const manifest = readManifest()
  if (!manifest) {
    console.error(`No corpus manifest at ${path.relative(process.cwd(), MANIFEST)}. Run: npm run corpus:update -- --reason "initial"`)
    return 2
  }
  const { entries, failed } = await renderAll()
  if (failed.length) {
    for (const f of failed) console.error(`✗ render failed — ${f}`)
    return 1
  }

  const before = new Map(manifest.documents.map(d => [key(d), d]))
  const after = new Map(entries.map(e => [key(e), e]))

  const changedApproved: string[] = []
  const changedUnreviewed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const [k, entry] of after) {
    const prior = before.get(k)
    if (!prior) { added.push(k); continue }
    if (prior.contentHash !== entry.contentHash) {
      (prior.approval.status === 'approved' ? changedApproved : changedUnreviewed).push(k)
    }
  }
  for (const k of before.keys()) if (!after.has(k)) removed.push(k)

  const total = after.size
  if (!changedApproved.length && !changedUnreviewed.length && !added.length && !removed.length) {
    console.log(`✓ corpus unchanged — ${total} documents match the manifest`)
    return 0
  }

  if (changedApproved.length) {
    console.error(`\n✗ ${changedApproved.length} ATTORNEY-APPROVED document(s) changed:`)
    for (const k of changedApproved) console.error(`    ${k}`)
    console.error('  Output a person signed off on is now different. Confirm the change is intended')
    console.error('  and have it re-reviewed before updating the manifest.')
  }
  if (changedUnreviewed.length) {
    console.log(`\n• ${changedUnreviewed.length} unreviewed document(s) changed:`)
    for (const k of changedUnreviewed) console.log(`    ${k}`)
  }
  if (added.length) { console.log(`\n• ${added.length} new document(s):`); for (const k of added) console.log(`    ${k}`) }
  if (removed.length) { console.log(`\n• ${removed.length} document(s) no longer produced:`); for (const k of removed) console.log(`    ${k}`) }
  console.log('\n  Accept these with: npm run corpus:update -- --reason "why"')

  // Only approved-document drift fails the gate. Everything else is reported
  // so it is visible in review without blocking work on unreviewed output.
  return changedApproved.length || removed.length ? 1 : 0
}

async function update(): Promise<number> {
  const reason = argOf('reason')
  if (!reason) {
    console.error('Refusing to rewrite the corpus without --reason "…". The reason is the record of why approved output changed.')
    return 2
  }
  const existing = readManifest()
  const prior = new Map((existing?.documents ?? []).map(d => [key(d), d]))
  const { entries, skipped, failed } = await renderAll()
  if (failed.length) { for (const f of failed) console.error(`✗ render failed — ${f}`); return 1 }

  const manifest: CorpusManifest = {
    version: 1,
    note: 'Golden-document corpus. Generated by `npm run corpus:update`; verified by `npm run corpus:check`. Approval is recorded per document and is the attorney\'s, not the tool\'s.',
    updatedAt: new Date().toISOString(),
    updatedReason: reason,
    documents: entries.map(e => {
      const before = prior.get(key(e))
      // An approval belongs to the bytes it was given. If the content changed,
      // the approval does not carry over.
      const carries = before && before.contentHash === e.contentHash
      return { ...e, approval: carries ? before.approval : { status: 'unreviewed' as const } }
    }),
  }
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

  const reset = manifest.documents.filter(d => d.approval.status === 'unreviewed' && prior.get(key(d))?.approval.status === 'approved')
  console.log(`✓ wrote ${manifest.documents.length} documents to ${path.relative(process.cwd(), MANIFEST)}`)
  if (skipped.length) console.log(`  ${skipped.length} package(s) skipped — no example payload: ${skipped.join(', ')}`)
  if (reset.length) console.log(`  ${reset.length} approval(s) cleared because the content changed — these need re-review.`)
  return 0
}

function list(): number {
  const manifest = readManifest()
  if (!manifest) { console.error('No corpus manifest yet.'); return 2 }
  const approved = manifest.documents.filter(d => d.approval.status === 'approved')
  console.log(`Golden corpus — ${manifest.documents.length} documents, ${approved.length} attorney-approved`)
  console.log(`Last updated ${manifest.updatedAt}: ${manifest.updatedReason}\n`)
  let pkg = ''
  for (const d of manifest.documents) {
    if (d.package !== pkg) { pkg = d.package; console.log(`  ${pkg}`) }
    const mark = d.approval.status === 'approved' ? '✓' : '·'
    console.log(`    ${mark} ${d.document}${d.approval.by ? `  (approved by ${d.approval.by})` : ''}`)
  }
  return 0
}

const mode = process.argv.includes('--update') ? update : process.argv.includes('--list') ? list : check
Promise.resolve(mode()).then(code => process.exit(code)).catch(error => {
  console.error(error)
  process.exit(1)
})
