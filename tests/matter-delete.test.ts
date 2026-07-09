import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('matter delete', () => {
  it('exposes DELETE on /api/admin/matters/[id]', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/route.ts'),
      'utf8',
    )
    expect(route).toContain('export async function DELETE')
    expect(route).toContain('requireAdmin')
    expect(route).toContain('deleteMatter')
  })

  it('cleans text-keyed child tables and intake', () => {
    const lib = fs.readFileSync(path.join(process.cwd(), 'lib/matters/deleteMatter.ts'), 'utf8')
    expect(lib).toContain("from('matter_documents').delete()")
    expect(lib).toContain("from('messages').delete()")
    expect(lib).toContain("from('client_intake').delete()")
  })
})
