import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { validateDocxStructure } from '@/lib/documentTemplates/docx'
import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'

const root = process.cwd()

function publicationClient(result: { data: unknown; error: { message: string } | null }, blob?: Blob) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  }
  return {
    from: () => query,
    storage: {
      from: () => ({
        download: async () => blob
          ? { data: blob, error: null }
          : { data: null, error: { message: 'missing object' } },
      }),
    },
  } as unknown as SupabaseClient
}

describe('document template workflow', () => {
  it('builds a unique, code-owned catalog for every supported DOCX category', () => {
    const registry = getDocumentTemplateRegistry()
    expect(new Set(registry.map(item => item.id)).size).toBe(registry.length)
    expect(new Set(registry.map(item => item.category))).toEqual(new Set(['estate', 'real_estate', 'engagement']))
    for (const template of registry) {
      expect(template.bundledPath).toMatch(/\.docx$/)
      expect(fs.existsSync(path.join(root, template.bundledPath))).toBe(true)
    }
  })

  it('rejects non-DOCX bytes and accepts a bundled Word master', () => {
    expect(validateDocxStructure(Buffer.from('not a docx'))).toMatch(/not a valid DOCX/i)
    const master = fs.readFileSync(path.join(root, 'tools/aubreylaw-docgeneration/templates/will.docx'))
    expect(validateDocxStructure(master)).toBeNull()
  })

  it('uses the bundled master when no publication exists', async () => {
    const resolved = await resolveDocumentTemplate(
      'estate-will',
      publicationClient({ data: null, error: null }),
    )
    expect(resolved.source).toBe('bundled')
    expect(resolved.versionId).toBeNull()
    expect(resolved.buffer.length).toBeGreaterThan(0)
  })

  it('fails closed when an active published object is unavailable', async () => {
    await expect(resolveDocumentTemplate(
      'estate-will',
      publicationClient({
        data: {
          version_id: 'v1',
          document_template_versions: {
            id: 'v1', version_number: 1, storage_path: 'estate-will/v1.docx', sha256: '0'.repeat(64),
          },
        },
        error: null,
      }),
    )).rejects.toThrow(/published template.*unavailable/i)
  })

  it('locks publication behind admin auth, validation, confirmation, and optimistic concurrency', () => {
    const auth = fs.readFileSync(path.join(root, 'lib/apiAuth.ts'), 'utf8')
    const route = fs.readFileSync(path.join(root, 'app/api/admin/settings/document-templates/[templateId]/publish/route.ts'), 'utf8')
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260713194628_document_template_workflow.sql'), 'utf8')

    expect(auth).toContain('export async function requireAdministrator')
    expect(auth).toContain("role !== 'admin'")
    expect(route).toContain('requireAdministrator(req)')
    expect(route).toContain("version.validation_status !== 'valid'")
    expect(migration).toContain('p_confirmation IS DISTINCT FROM p_template_id')
    expect(migration).toContain('v_current IS DISTINCT FROM p_expected_active_version_id')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('TO service_role')
  })

  it('consolidates email and firma editors into the administrator Template Center', () => {
    const settings = fs.readFileSync(path.join(root, 'app/admin/settings/StaffSettingsClient.tsx'), 'utf8')
    const center = fs.readFileSync(path.join(root, 'app/admin/settings/TemplateCenter.tsx'), 'utf8')
    const email = fs.readFileSync(path.join(root, 'app/admin/settings/EmailSettingsSection.tsx'), 'utf8')
    expect(settings).toContain("isAdministrator ? [['templates', 'Templates']")
    expect(center).toContain('<EmailTemplatesSection')
    expect(center).toContain('<EsignTemplateEditor')
    expect(email).not.toContain('<EmailTemplatesSection')
  })

  it('shows upload and active-publication timestamps in the Template Center', () => {
    const documentTemplates = fs.readFileSync(
      path.join(root, 'app/admin/settings/DocumentTemplatesSection.tsx'),
      'utf8',
    )
    expect(documentTemplates).toContain('Last uploaded:')
    expect(documentTemplates).toContain('lastUpload.createdAt')
    expect(documentTemplates).toContain('Active version published')
    expect(documentTemplates).toContain('template.publishedAt')
  })
})
