import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('document audit route', () => {
  const routePath = path.join(process.cwd(), 'app/api/admin/documents/audit/route.ts')
  const documentsHelper = fs.readFileSync(path.join(process.cwd(), 'lib/documents.ts'), 'utf8')

  it('is attorney-only and supports matter/document filters', () => {
    const route = fs.readFileSync(routePath, 'utf8')

    expect(route).toContain('getDocumentApiUser')
    expect(route).toContain('isAdminUser')
    expect(route).toContain("NextResponse.json({ error: 'Forbidden' }, { status: 403 })")
    expect(route).toContain("from('document_access_audit')")
    expect(route).toContain(".eq('matter_id', matterId)")
    expect(route).toContain(".eq('document_id', documentId)")
    expect(route).toContain(".order('created_at', { ascending: false })")
    expect(route).toContain('Math.min(100')
  })

  it('exposes an admin helper and keeps audit data out of portal/client routes', () => {
    expect(documentsHelper).toContain('getDocumentAuditEvents')
    expect(documentsHelper).toContain('/api/admin/documents/audit')

    const portalSources = [
      'app/dashboard/page.tsx',
      'app/documents/page.tsx',
      'app/messages/page.tsx',
    ].filter(file => fs.existsSync(path.join(process.cwd(), file)))

    for (const file of portalSources) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source).not.toContain('getDocumentAuditEvents')
      expect(source).not.toContain('/api/admin/documents/audit')
    }
  })
})
