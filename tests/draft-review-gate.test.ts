import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canPromoteDraft } from '@/lib/drafting/reviewGate'

describe('canPromoteDraft', () => {
  it('allows a marker-clean, reviewed draft', () => {
    expect(canPromoteDraft({ markerCount: 0, reviewedAt: '2026-06-12T00:00:00Z' })).toEqual({ ok: true })
  })

  it('blocks on unresolved markers even when reviewed', () => {
    expect(canPromoteDraft({ markerCount: 2, reviewedAt: '2026-06-12T00:00:00Z' }))
      .toEqual({ ok: false, reason: 'markers' })
  })

  it('blocks a clean but unreviewed draft', () => {
    expect(canPromoteDraft({ markerCount: 0, reviewedAt: null }))
      .toEqual({ ok: false, reason: 'not_reviewed' })
  })

  it('does not block legacy drafts (null marker count) on markers, but still requires review', () => {
    expect(canPromoteDraft({ markerCount: null, reviewedAt: null }))
      .toEqual({ ok: false, reason: 'not_reviewed' })
    expect(canPromoteDraft({ markerCount: null, reviewedAt: '2026-06-12T00:00:00Z' }))
      .toEqual({ ok: true })
  })
})

describe('documents PATCH review gate wiring', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/[id]/route.ts'),
    'utf8',
  )

  it('loads marker_count and reviewed_at for the gate', () => {
    expect(routeSource).toContain('marker_count, reviewed_at, reviewed_by')
  })

  it('requires explicit confirmation before promoting internal drafts to client-visible folders', () => {
    expect(routeSource).toContain("code: 'promotion_not_confirmed'")
    expect(routeSource).toContain('promotionToClientVisible && confirmed !== true')
    expect(routeSource).toContain('folder: toFolder')
  })

  it('records the review toggle in the audit trail', () => {
    expect(routeSource).toContain('isReviewToggle')
    expect(routeSource).toContain("auditDocumentAccess(sb, user, data, 'review'")
  })
})
