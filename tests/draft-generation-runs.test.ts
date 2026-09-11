import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectSupersededDraftIds, stableDraftKey } from '@/lib/drafting/supersede'

describe('stableDraftKey', () => {
  it('strips the date prefix and .docx suffix so identity is stable across runs', () => {
    expect(stableDraftKey('2026-06-12_Jane Smith_Pour-Over Will.docx')).toBe('Jane Smith_Pour-Over Will')
    // Same document regenerated on a different day collapses to the same key.
    expect(stableDraftKey('2026-07-01_Jane Smith_Pour-Over Will.docx'))
      .toBe(stableDraftKey('2026-06-12_Jane Smith_Pour-Over Will.docx'))
  })
})

describe('selectSupersededDraftIds', () => {
  const priorDrafts = [
    { id: 'a', name: '2026-06-10_Jane Smith_Pour-Over Will.docx' },
    { id: 'b', name: '2026-06-10_Jane Smith_Durable Power of Attorney.docx' },
    { id: 'c', name: '2026-06-10_Jane Smith_Health Care Proxy.docx' },
  ]

  it('supersedes every prior draft on a full-set regeneration', () => {
    const ids = selectSupersededDraftIds({
      priorDrafts,
      regeneratedNames: [
        '2026-06-12_Jane Smith_Pour-Over Will.docx',
        '2026-06-12_Jane Smith_Durable Power of Attorney.docx',
        '2026-06-12_Jane Smith_Health Care Proxy.docx',
      ],
      fullSet: true,
    })
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('supersedes only the regenerated titles on a subset run', () => {
    const ids = selectSupersededDraftIds({
      priorDrafts,
      regeneratedNames: ['2026-06-12_Jane Smith_Pour-Over Will.docx'],
      fullSet: false,
    })
    expect(ids).toEqual(['a'])
  })

  it('supersedes nothing when a subset regenerates a brand-new title', () => {
    const ids = selectSupersededDraftIds({
      priorDrafts,
      regeneratedNames: ['2026-06-12_Jane Smith_HIPAA Authorization.docx'],
      fullSet: false,
    })
    expect(ids).toEqual([])
  })
})

describe('draft route generation-run wiring', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/matters/[id]/draft/route.ts'),
    'utf8',
  )

  it('stamps one generation id per request with engine and marker counts', () => {
    expect(routeSource).toContain('const generationId = run?.id ?? randomUUID()')
    // The provenance branch inserts directly; the standard branch registers via
    // the shared lib/drafting/persistGeneratedDocument helper.
    expect(routeSource).toContain('generation_id: generationId')
    expect(routeSource).toContain('generationId,')
    expect(routeSource).toContain('generationEngine,')
    expect(routeSource).toContain('markerCount: scan.markerCount')
    expect(routeSource).toContain('missingCount: scan.missingFields.length')
    const persistSource = fs.readFileSync(
      path.join(process.cwd(), 'lib/drafting/persistGeneratedDocument.ts'),
      'utf8',
    )
    expect(persistSource).toContain('generation_id: args.generationId')
    expect(persistSource).toContain('generation_engine: args.generationEngine')
    expect(persistSource).toContain('marker_count: args.markerCount')
    expect(persistSource).toContain('missing_count: args.missingCount')
  })

  it('captures prior non-superseded drafts before inserting and supersedes after upload', () => {
    expect(routeSource).toContain(".is('superseded_at', null)")
    expect(routeSource).toContain('selectSupersededDraftIds({')
    expect(routeSource).toContain("fullSet: selectedDocuments === null")
    expect(routeSource).toContain("update({ superseded_at: new Date().toISOString() })")
    // Prior-draft snapshot must be read before the upload loop inserts new rows.
    expect(routeSource.indexOf('const priorDrafts')).toBeLessThan(
      routeSource.indexOf('selectSupersededDraftIds({'),
    )
  })
})
