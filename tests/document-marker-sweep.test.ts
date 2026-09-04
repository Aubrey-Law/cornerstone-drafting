import { describe, expect, it } from 'vitest'
import {
  formatSweepReport,
  summarizeSweep,
  type SweptDocument,
} from '@/lib/documents/markerSweep'

const MATTER_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const MATTER_B = 'bbbbbbbb-2222-4222-8222-222222222222'

function doc(overrides: Partial<SweptDocument> & Pick<SweptDocument, 'id'>): SweptDocument {
  return {
    name: `${overrides.id}.docx`,
    matterId: MATTER_A,
    matterLabel: 'M-001 · Shaw',
    sharedAt: null,
    supersededAt: null,
    check: { shareable: true },
    ...overrides,
  }
}

function blocked(id: string, missingFields: string[], rest: Partial<SweptDocument> = {}) {
  return doc({ id, check: { shareable: false, reason: 'missing_fields', missingFields }, ...rest })
}

describe('summarizeSweep', () => {
  it('ranks a field by how many drafts filling it would unblock', () => {
    const report = summarizeSweep([
      blocked('a', ['client.street_address', 'healthcare.agent.primary.phone']),
      blocked('b', ['client.street_address']),
      blocked('c', ['client.street_address'], { matterId: MATTER_B, matterLabel: 'M-002 · Duchin' }),
    ])

    expect(report.fields.map(f => [f.path, f.documentCount, f.matterCount])).toEqual([
      ['client.street_address', 3, 2],
      ['healthcare.agent.primary.phone', 1, 1],
    ])
  })

  it('names the design-sheet section to open for each blank', () => {
    const report = summarizeSweep([blocked('a', ['client.street_address'])])

    const [field] = report.fields
    expect(field.sectionLabel).toBeTruthy()
    expect(field.sectionLabel).not.toBe(field.sectionId)
    expect(field.label).not.toBe('client.street_address')
  })

  it('separates a document already with the client from one merely unshared', () => {
    const report = summarizeSweep([
      blocked('out', ['client.street_address'], { sharedAt: '2026-08-01T00:00:00Z' }),
      blocked('in', ['client.street_address']),
    ])

    expect(report.shared.map(d => d.id)).toEqual(['out'])
    expect(report.actionable.map(d => d.id)).toEqual(['in'])
  })

  it('counts a shared document even when a later draft supersedes it', () => {
    // The replacement does not close the portal on the one already delivered.
    const report = summarizeSweep([
      blocked('out', ['client.street_address'], {
        sharedAt: '2026-08-01T00:00:00Z',
        supersededAt: '2026-08-09T00:00:00Z',
      }),
    ])

    expect(report.shared.map(d => d.id)).toEqual(['out'])
    expect(report.superseded).toHaveLength(0)
    expect(report.fields[0].documentCount).toBe(1)
  })

  it('reports a superseded unshared draft without counting its blanks as work', () => {
    const report = summarizeSweep([
      blocked('old', ['client.street_address'], { supersededAt: '2026-08-09T00:00:00Z' }),
    ])

    expect(report.superseded.map(d => d.id)).toEqual(['old'])
    expect(report.actionable).toHaveLength(0)
    expect(report.fields).toHaveLength(0)
  })

  it('keeps an unreadable document out of the field tally but still reports it', () => {
    const report = summarizeSweep([
      doc({
        id: 'broken',
        check: { shareable: false, reason: 'unverifiable', detail: 'could not be opened' },
      }),
    ])

    expect(report.unverifiable.map(d => d.id)).toEqual(['broken'])
    expect(report.fields).toHaveLength(0)
    expect(report.actionable).toHaveLength(0)
  })

  it('orders matters by how many blocked drafts each one has', () => {
    const report = summarizeSweep([
      blocked('a', ['x'], { matterId: MATTER_B, matterLabel: 'M-002 · Duchin' }),
      blocked('b', ['x']),
      blocked('c', ['x']),
    ])

    expect(report.matters.map(m => [m.matterId, m.documents.length])).toEqual([
      [MATTER_A, 2],
      [MATTER_B, 1],
    ])
  })

  it('is stable across runs when two fields block the same number of drafts', () => {
    const first = summarizeSweep([blocked('a', ['zebra.field', 'alpha.field'])])
    const second = summarizeSweep([blocked('a', ['alpha.field', 'zebra.field'])])

    expect(first.fields.map(f => f.path)).toEqual(second.fields.map(f => f.path))
  })

  it('counts shareable documents rather than silently dropping them', () => {
    const report = summarizeSweep([doc({ id: 'clean' }), blocked('dirty', ['x'])])

    expect(report.scanned).toBe(2)
    expect(report.shareable).toBe(1)
  })
})

describe('formatSweepReport', () => {
  it('leads with the documents already with the client', () => {
    const text = formatSweepReport(
      summarizeSweep([
        blocked('in', ['client.street_address']),
        blocked('out', ['client.street_address'], { sharedAt: '2026-08-01T00:00:00Z' }),
      ]),
    )

    expect(text).toContain('ALREADY WITH THE CLIENT')
    expect(text.indexOf('ALREADY WITH THE CLIENT')).toBeLessThan(text.indexOf('FIELDS TO FILL'))
  })

  it('says nothing about clients when nothing has been shared', () => {
    const text = formatSweepReport(summarizeSweep([blocked('in', ['client.street_address'])]))

    expect(text).not.toContain('ALREADY WITH THE CLIENT')
    expect(text).toContain('FIELDS TO FILL')
  })

  it('renders a clean sweep as an answer rather than an empty report', () => {
    const text = formatSweepReport(summarizeSweep([doc({ id: 'clean' })]))

    expect(text).toContain('Nothing is blocked')
    expect(text).not.toContain('FIELDS TO FILL')
  })

  it('reports each field by its readable label and where to fill it', () => {
    const text = formatSweepReport(summarizeSweep([blocked('a', ['client.street_address'])]))

    // The raw path is present for grepping, but it is not what leads the line —
    // a worklist that reads as dotted paths is one the attorney has to decode.
    const [line] = text.split('\n').filter(l => l.includes('1 draft'))
    expect(line).toBeTruthy()
    expect(line).not.toContain('client.street_address')
    expect(text).toContain('client.street_address')
  })

  it('marks a shared draft in the per-matter listing', () => {
    const text = formatSweepReport(
      summarizeSweep([blocked('out', ['x'], { sharedAt: '2026-08-01T00:00:00Z' })]),
    )

    expect(text).toContain('[SHARED]')
  })

  it('pluralises counts rather than printing "1 drafts"', () => {
    const text = formatSweepReport(summarizeSweep([blocked('a', ['x'])]))

    expect(text).toContain('1 draft')
    expect(text).not.toContain('1 drafts')
    expect(text).not.toContain('1 blanks')
  })

  it('mentions superseded drafts without listing them as work', () => {
    const text = formatSweepReport(
      summarizeSweep([blocked('old', ['x'], { supersededAt: '2026-08-09T00:00:00Z' })]),
    )

    expect(text).toContain('superseded draft')
    expect(text).toContain('nothing to fix')
    expect(text).not.toContain('FIELDS TO FILL')
  })
})
