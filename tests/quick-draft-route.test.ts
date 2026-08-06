import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/matters/[id]/quick-draft/route.ts'),
  'utf8',
)
const quickDraftSource = fs.readFileSync(path.join(process.cwd(), 'lib/drafting/quickDraft.ts'), 'utf8')
const assembleSource = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/assemble.ts'), 'utf8')
const validateSource = fs.readFileSync(path.join(process.cwd(), 'lib/documentTemplates/validate.ts'), 'utf8')
const draftRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/matters/[id]/draft/route.ts'),
  'utf8',
)

describe('quick-draft route', () => {
  it('is admin-guarded on both handlers', () => {
    expect(routeSource).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    expect(routeSource.match(/await requireAdmin\(req\)/g)?.length).toBe(2)
  })

  it('renders in partial mode so missing design sheets and non-hired matters do not block', () => {
    expect(routeSource).toContain('allowPartial: true')
  })

  it('supports analyze, download, and save modes', () => {
    expect(routeSource).toContain("value === 'analyze' || value === 'download' || value === 'save'")
    expect(routeSource).toContain("mode === 'analyze'")
    expect(routeSource).toContain("mode === 'download'")
    expect(routeSource).toContain('X-Missing-Count')
  })

  it('whitelists override paths before rendering', () => {
    expect(routeSource).toContain('isOverridablePath(key)')
    expect(quickDraftSource).toContain("const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])")
  })

  it('saves with a distinct generation engine and no supersede of full-run drafts', () => {
    expect(routeSource).toContain("generationEngine: 'quick-draft'")
    expect(routeSource).not.toContain('selectSupersededDraftIds')
    expect(routeSource).not.toContain('superseded_at')
  })

  it('persists quick-draft answers under decisions.quick_draft keyed by template', () => {
    expect(routeSource).toContain('decisions.quick_draft = quickDraft')
    expect(routeSource).toContain('quickDraft[templateId]')
  })

  it('scans the rendered buffer for markers before save/download', () => {
    expect(routeSource).toContain('scanDocxBufferForMarkers(rendered.buffer)')
    expect(routeSource).toContain('markerCount: scan.markerCount')
    expect(routeSource).toContain('missingCount: scan.missingFields.length')
  })
})

describe('quick-draft render core', () => {
  it('resolves the published template override before falling back to bundled', () => {
    expect(quickDraftSource).toContain("import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'")
    expect(quickDraftSource).toContain('await resolveDocumentTemplate(args.templateId)')
  })

  it('only serves estate templates (real-estate and engagement have their own flows)', () => {
    expect(quickDraftSource).toContain("definition.category !== 'estate'")
  })

  it('is reused by template-candidate validation (single render implementation)', () => {
    expect(validateSource).toContain("import { renderSingleTemplateForMatter } from '@/lib/drafting/quickDraft'")
    expect(validateSource).not.toContain('renderNodeEstateDocxTemplate')
  })
})

describe('buildDraftPayload partial mode', () => {
  it('keeps the hired gate and missing-sheet throw for the default path', () => {
    expect(assembleSource).toContain("if (matter.relationship_status !== 'hired' && !options.allowPartial)")
    expect(assembleSource).toContain("throw new Error('No design sheet found for matter: ' + resolvedMatterId)")
  })

  it('substitutes a blank in-memory sheet only when allowPartial is set', () => {
    expect(assembleSource).toContain('if (!options.allowPartial) {')
    expect(assembleSource).toContain("rawDesignSheet = { id: '', status: null, decisions: {} } as DesignSheetRow")
    expect(assembleSource).toContain('design_sheet_id: designSheet.id || null')
  })

  it('is never enabled by the full draft route', () => {
    expect(draftRouteSource).not.toContain('allowPartial')
  })
})

describe('extras variable passthrough', () => {
  it('flows decisions.extras through the payload into generator data', () => {
    expect(assembleSource).toContain('const rawExtras = (designSheet.decisions as Record<string, unknown> | null)?.extras')
    const generatorSource = fs.readFileSync(
      path.join(process.cwd(), 'lib/estateGenerator/toGeneratorData.ts'),
      'utf8',
    )
    expect(generatorSource).toContain('extras: payload.extras ?? {}')
  })

  it('keeps extras under decisions jsonb, never as a top-level sheet column', () => {
    const persistenceSource = fs.readFileSync(path.join(process.cwd(), 'lib/designSheetPersistence.ts'), 'utf8')
    expect(persistenceSource).toContain("'extras',")
  })
})
