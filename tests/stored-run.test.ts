import { describe, expect, it } from 'vitest'
import { toStoredRun } from '@/lib/review/history'

const runRow = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  matter_id: 'm-1',
  document_version_id: 'v-1',
  text_layer_id: 'l-1',
  prompt_version_id: 'pv-1',
  kind: 'review',
  status: 'completed',
  rule_total: 2,
  finding_count: 2,
  failed_count: 0,
  failures: [],
  finished_at: '2026-09-05T12:00:00Z',
  ...over,
})

const promptVersionRow = (over: Record<string, unknown> = {}) => ({
  id: 'pv-1',
  prompt_id: 'p-1',
  version_number: 1,
  ...over,
})

const promptRow = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  slug: 'ma-trust-firm-qa',
  ...over,
})

const findingRow = (over: Record<string, unknown> = {}) => ({
  id: 'f-1',
  rule_number: '1',
  outcome: 'deviation',
  severity: 'high',
  rationale: 'Carve-out is too narrow.',
  proposed_language: 'willful misconduct, bad faith, or gross negligence',
  citation_refusal: null,
  attempted_quote: null,
  disposition: 'open',
  disposition_note: null,
  ...over,
})

const citationRow = (over: Record<string, unknown> = {}) => ({
  finding_id: 'f-1',
  block_index: 17,
  char_start: 5589,
  char_end: 5965,
  page: null,
  bbox: null,
  quote: 'willful acts or omissions',
  verification: 'verified',
  ...over,
})

const layerRow = {
  source_kind: 'docx',
  status: 'ok',
  extractor: 'docx',
  extractor_version: '1',
  source_sha256: 'a'.repeat(64),
  page_count: null,
  text: 'x'.repeat(6000),
  blocks: [{ index: 17, charStart: 5589, charEnd: 5965, text: 'y', page: null, bbox: null }],
  spans: [],
}

describe('toStoredRun', () => {
  it('rebuilds a finding with its verified citation attached', () => {
    const run = toStoredRun(runRow(), [findingRow()], [citationRow()], layerRow)
    const [finding] = run.findings
    expect(finding.findingId).toBe('f-1')
    expect(finding.citation).toMatchObject({ blockIndex: 17, charStart: 5589, quote: 'willful acts or omissions' })
    expect(finding.citation?.verification).toBe('verified')
  })

  /**
   * An uncited finding is not a broken one. It keeps its rationale and the
   * words it could not support, which is what lets the refusal be judged later
   * rather than only at the moment it happened.
   */
  it('rebuilds an uncited finding with its refusal and attempted quote', () => {
    const run = toStoredRun(
      runRow(),
      [findingRow({ citation_refusal: 'not_found', attempted_quote: 'words not in the document' })],
      [],
      layerRow,
    )
    const [finding] = run.findings
    expect(finding.citation).toBeNull()
    expect(finding.citationRefusal).toBe('not_found')
    expect(finding.attemptedQuote).toBe('words not in the document')
  })

  it('carries the decision recorded against each finding', () => {
    const run = toStoredRun(
      runRow(),
      [findingRow({ disposition: 'accepted', disposition_note: 'Fixed in the template.' })],
      [citationRow()],
      layerRow,
    )
    expect(run.findings[0]).toMatchObject({ disposition: 'accepted', dispositionNote: 'Fixed in the template.' })
  })

  it('never attaches one finding’s citation to another', () => {
    const run = toStoredRun(
      runRow(),
      [findingRow({ id: 'f-1', rule_number: '1' }), findingRow({ id: 'f-2', rule_number: '2' })],
      [citationRow({ finding_id: 'f-2', quote: 'the second one' })],
      layerRow,
    )
    expect(run.findings.find((f) => f.findingId === 'f-1')?.citation).toBeNull()
    expect(run.findings.find((f) => f.findingId === 'f-2')?.citation?.quote).toBe('the second one')
  })

  /**
   * The layer is what the offsets index. Without it a stored citation is two
   * numbers, so the view must know it cannot highlight rather than highlight
   * the wrong thing.
   */
  it('reports no layer rather than inventing one', () => {
    const run = toStoredRun(runRow({ text_layer_id: null }), [findingRow()], [], null)
    expect(run.layer).toBeNull()
  })

  it('rebuilds the layer the citations index', () => {
    const run = toStoredRun(runRow(), [findingRow()], [citationRow()], layerRow)
    expect(run.layer?.blocks).toHaveLength(1)
    expect(run.layer?.sourceKind).toBe('docx')
  })

  it('carries which rules never ran, so the record does not overstate coverage', () => {
    const run = toStoredRun(
      runRow({ status: 'partial', failed_count: 1, failures: [{ ruleNumber: '3', reason: 'overloaded' }] }),
      [findingRow()],
      [],
      layerRow,
    )
    expect(run.status).toBe('partial')
    expect(run.failures).toEqual([{ ruleNumber: '3', reason: 'overloaded' }])
  })

  it('orders findings by rule number', () => {
    const run = toStoredRun(
      runRow(),
      [findingRow({ id: 'f-10', rule_number: '10' }), findingRow({ id: 'f-2', rule_number: '2' })],
      [],
      layerRow,
    )
    expect(run.findings.map((f) => f.ruleNumber)).toEqual(['2', '10'])
  })

  /**
   * playbook_slug/playbook_version were dropped in favour of
   * prompt_version_id: a run now records the version it was checked
   * against by reference, not by a slug-and-integer pair that could be
   * edited independently of the run.
   */
  it('carries the run’s kind and the version it points at', () => {
    const run = toStoredRun(runRow(), [findingRow()], [], layerRow)
    expect(run.kind).toBe('review')
    expect(run.promptVersionId).toBe('pv-1')
  })

  it('defaults kind to review for a run recorded before the column existed', () => {
    const run = toStoredRun(runRow({ kind: undefined }), [findingRow()], [], layerRow)
    expect(run.kind).toBe('review')
  })

  /**
   * The slug and version number are looked up separately, not through an
   * embedded select — see the comment on toStoredRun. Passing both rows
   * shows a human-readable label; the two lookups are what fill it in.
   */
  it('names the prompt version when it is passed the rows to join', () => {
    const run = toStoredRun(runRow(), [findingRow()], [], layerRow, promptVersionRow(), promptRow())
    expect(run.promptSlug).toBe('ma-trust-firm-qa')
    expect(run.promptVersionNumber).toBe(1)
  })

  /**
   * A run whose prompt_version_id no longer resolves to a real version (the
   * version's prompt was deleted, or the lookup simply was not done) reports
   * that it cannot say, rather than inventing a slug or a number.
   */
  it('reports no prompt slug or version number when neither row is joined', () => {
    const run = toStoredRun(runRow(), [findingRow()], [], layerRow)
    expect(run.promptSlug).toBeNull()
    expect(run.promptVersionNumber).toBeNull()
  })
})
