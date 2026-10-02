import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'
import { validateDocxStructure } from '@/lib/documentTemplates/docx'
import { resolveDocumentTemplate } from '@/lib/documentTemplates/resolver'
import { cancelDocumentTemplateVersion } from '@/lib/documentTemplates/repository'

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
    expect(registry.find(item => item.id === 'real-estate-deed')?.bundledPath).toMatch(/\/deed\.docx$/)
    expect(registry.find(item => item.id === 'real-estate-deed-land-court')?.bundledPath)
      .toMatch(/\/deed-landcourt\.docx$/)
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

  it('locks publication behind admin auth, confirmation, and optimistic concurrency without requiring validation', () => {
    const auth = fs.readFileSync(path.join(root, 'lib/apiAuth.ts'), 'utf8')
    const route = fs.readFileSync(path.join(root, 'app/api/admin/settings/document-templates/[templateId]/publish/route.ts'), 'utf8')
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260713194628_document_template_workflow.sql'), 'utf8')
    const relaxedMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260716193000_relax_template_clause_validation_publication.sql'), 'utf8')
    const templates = fs.readFileSync(path.join(root, 'app/admin/settings/DocumentTemplatesSection.tsx'), 'utf8')

    expect(auth).toContain('export async function requireAdministrator')
    expect(auth).toContain("role !== 'admin'")
    expect(route).toContain('requireAdministrator(req)')
    expect(route).not.toContain("version.validation_status !== 'valid'")
    expect(templates).not.toContain("!version.isActive && version.validationStatus === 'valid'")
    expect(migration).toContain('p_confirmation IS DISTINCT FROM p_template_id')
    expect(migration).toContain('v_current IS DISTINCT FROM p_expected_active_version_id')
    expect(relaxedMigration).toContain('CREATE OR REPLACE FUNCTION public.publish_document_template_version')
    expect(relaxedMigration).not.toContain("v_status <> 'valid'")
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('TO service_role')
  })

  it('keeps the email, firma and clause editors in the administrator-only Library tabs', () => {
    const library = fs.readFileSync(path.join(root, 'app/admin/works/WorksClient.tsx'), 'utf8')
    const settings = fs.readFileSync(path.join(root, 'app/admin/settings/StaffSettingsClient.tsx'), 'utf8')
    const settingsPage = fs.readFileSync(path.join(root, 'app/admin/settings/page.tsx'), 'utf8')
    const email = fs.readFileSync(path.join(root, 'app/admin/settings/EmailSettingsSection.tsx'), 'utf8')
    expect(fs.existsSync(path.join(root, 'app/admin/settings/TemplateCenter.tsx'))).toBe(false)
    expect(library).toContain('<EmailTemplatesSection')
    expect(library).toContain('<EsignTemplateEditor')
    expect(library).toContain('<EstateClauseLibrarySection currentUserId={currentUserId}')
    for (const tab of ['documents', 'email-templates', 'esign', 'clauses']) {
      expect(library).toMatch(new RegExp(`value: '${tab}',[^}]*adminOnly: true`))
      expect(library).toContain(`{canManageMasters && <TabsContent value="${tab}"`)
    }
    expect(library.match(/<TabsList(?:\s|>)/g)).toHaveLength(1)
    // Old Settings links land on the Library instead of a blank tab.
    expect(settingsPage).toContain("redirect('/admin/works?tab=email-templates')")
    expect(settings).not.toContain('TemplateCenter')
    expect(email).not.toContain('<EmailTemplatesSection')
  })

  it('shows upload and active-publication timestamps on the document masters', () => {
    const documentTemplates = fs.readFileSync(
      path.join(root, 'app/admin/settings/DocumentTemplatesSection.tsx'),
      'utf8',
    )
    expect(documentTemplates).toContain('Last uploaded:')
    expect(documentTemplates).toContain('lastUpload.createdAt')
    expect(documentTemplates).toContain('Active version published')
    expect(documentTemplates).toContain('template.publishedAt')
  })

  it('does not cancel the native DOCX file picker and validates uploads by extension and structure', () => {
    const documentTemplates = fs.readFileSync(
      path.join(root, 'app/admin/settings/DocumentTemplatesSection.tsx'),
      'utf8',
    )
    const uploadRoute = fs.readFileSync(
      path.join(root, 'app/api/admin/settings/document-templates/[templateId]/versions/route.ts'),
      'utf8',
    )
    expect(documentTemplates).toContain('event.stopPropagation()')
    expect(documentTemplates).not.toContain('event => event.preventDefault()')
    expect(uploadRoute).toContain("file.name.toLowerCase().endsWith('.docx')")
    expect(uploadRoute).not.toContain('file.type !==')
    expect(uploadRoute).toContain('validateDocxStructure(buffer)')
  })

  it('searches for a validation matter instead of requiring a pasted UUID', () => {
    const documentTemplates = fs.readFileSync(
      path.join(root, 'app/admin/settings/DocumentTemplatesSection.tsx'),
      'utf8',
    )
    const matterSearchPicker = fs.readFileSync(
      path.join(root, 'app/admin/settings/MatterSearchPicker.tsx'),
      'utf8',
    )
    const matterSearchRoute = fs.readFileSync(
      path.join(root, 'app/api/admin/settings/document-templates/matters/route.ts'),
      'utf8',
    )
    expect(documentTemplates).toContain('MatterSearchPicker')
    expect(matterSearchPicker).toContain('Search by client, matter name, or email')
    expect(matterSearchPicker).not.toContain('Paste a compatible matter UUID')
    expect(matterSearchRoute).toContain('requireAdministrator(req)')
    expect(matterSearchRoute).toContain("from('v_matter_pipeline')")
  })

  it('cancels an unpublished upload and removes its private storage object', async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { storagePath: 'estate-will/version.docx' },
        error: null,
      }),
      storage: { from: vi.fn(() => ({ remove })) },
    } as unknown as SupabaseClient

    await expect(cancelDocumentTemplateVersion({
      templateId: 'estate-will',
      versionId: 'version-id',
      actorId: 'admin-id',
      client,
    })).resolves.toEqual({ canceled: true, cleanupWarning: null })
    expect(remove).toHaveBeenCalledWith(['estate-will/version.docx'])
  })

  it('protects active and previously published versions from cancellation', () => {
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260713222004_cancel_document_template_uploads.sql'),
      'utf8',
    )
    expect(migration).toContain('The active template version cannot be canceled')
    expect(migration).toContain('A previously published template version cannot be canceled')
    expect(migration).toContain("'canceled'")
    expect(migration).toContain("WHERE validation_status <> 'canceled'")
  })
})
