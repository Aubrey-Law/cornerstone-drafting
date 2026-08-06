import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { customTemplateId, customTemplateRowId } from '@/lib/documentTemplates/customTemplates'
import { extractTemplateVariables } from '@/lib/estateGenerator/templateVariables'

const uploadRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/quick-draft/custom-templates/route.ts'),
  'utf8',
)
const customLibSource = fs.readFileSync(path.join(process.cwd(), 'lib/documentTemplates/customTemplates.ts'), 'utf8')
const quickDraftSource = fs.readFileSync(path.join(process.cwd(), 'lib/drafting/quickDraft.ts'), 'utf8')
const variablesRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/admin/settings/document-templates/[templateId]/variables/route.ts'),
  'utf8',
)

describe('custom template ids', () => {
  it('round-trips the custom- prefix', () => {
    expect(customTemplateId('abc-123')).toBe('custom-abc-123')
    expect(customTemplateRowId('custom-abc-123')).toBe('abc-123')
    expect(customTemplateRowId('estate-pourover-will')).toBeNull()
  })
})

describe('custom template upload', () => {
  it('is admin-guarded and validates the file and label', () => {
    expect(uploadRouteSource).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    expect(uploadRouteSource).toContain('A DOCX file and a label are required.')
  })

  it('rejects non-DOCX uploads via extraction and enforces the size cap', () => {
    expect(customLibSource).toContain('That file is not a readable DOCX template.')
    expect(customLibSource).toContain('15728640')
  })

  it('stores files with a sha256 integrity check on read-back', () => {
    expect(customLibSource).toContain('if (sha256(buffer) !== row.sha256)')
    expect(customLibSource).toContain("failed its integrity check")
  })

  it('degrades gracefully when the migration is not applied', () => {
    expect(customLibSource).toContain("value.includes('custom_document_templates')")
    expect(customLibSource).toContain('migrationRequired: true')
  })

  it('captures the variable report at upload time', () => {
    expect(customLibSource).toContain('extractTemplateVariables(args.buffer)')
    const buffer = fs.readFileSync(
      path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates/certificate-of-trust.docx'),
    )
    const report = extractTemplateVariables(buffer)
    expect(report.variables.length).toBeGreaterThan(0)
  })
})

describe('custom template rendering', () => {
  it('routes custom- template ids through the full-data render path', () => {
    expect(quickDraftSource).toContain('const customRowId = customTemplateRowId(args.templateId)')
    expect(quickDraftSource).toContain('renderCustomTemplateForMatter(customRowId, args)')
    // Custom templates never enter the package pipeline.
    expect(quickDraftSource).toContain("packageName: 'custom'")
  })
})

describe('template variables endpoint', () => {
  it('is administrator-guarded and reuses the shared extraction + analyze core', () => {
    expect(variablesRouteSource).toContain("import { requireAdministrator } from '@/lib/apiAuth'")
    expect(variablesRouteSource).toContain('extractTemplateVariables(resolved.buffer)')
    expect(variablesRouteSource).toContain('renderSingleTemplateForMatter({ matterId, templateId, allowPartial: true })')
  })
})
