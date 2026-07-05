import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('drafting app smoke', () => {
  it('exposes the drafting hub and workspace routes', () => {
    expect(fs.existsSync(path.join(root, 'app/admin/drafting/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'app/admin/drafting/[matterId]/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'))).toBe(true)
  })

  it('keeps the design sheet under the drafting workspace', () => {
    expect(fs.existsSync(path.join(root, 'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'app/admin/matters/[id]/design/page.tsx'))).toBe(true)

    const legacy = fs.readFileSync(path.join(root, 'app/admin/matters/[id]/design/page.tsx'), 'utf8')
    expect(legacy).toContain('redirect(`/admin/drafting/${id}?step=design`)')
  })

  it('wires draft payload assembly through the public barrel', () => {
    const barrel = fs.readFileSync(path.join(root, 'lib/buildDraftPayload.ts'), 'utf8')
    expect(barrel).toContain("export { buildDraftPayload } from '@/lib/draftPayload/assemble'")
    expect(barrel).toContain("export { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'")
    expect(barrel).toContain("export { draftPayloadChildren } from '@/lib/draftPayload/helpers'")
  })

  it('centralizes estate generator engine selection', () => {
    const route = fs.readFileSync(path.join(root, 'app/api/admin/matters/[id]/draft/route.ts'), 'utf8')
    expect(route).toContain('resolveEstateGeneratorEngine()')
    expect(route).toContain('@/lib/estateGenerator/engine')
  })

  it('requires only drafting auth entry points', () => {
    expect(fs.existsSync(path.join(root, 'app/auth/login/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'app/auth/callback/route.ts'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'app/auth/signup/page.tsx'))).toBe(false)
  })
})
