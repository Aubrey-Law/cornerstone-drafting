import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('global search', () => {
  it('wires lite global search into admin header', () => {
    const layout = fs.readFileSync(path.join(process.cwd(), 'app/admin/AdminLayoutClient.tsx'), 'utf8')
    const search = fs.readFileSync(path.join(process.cwd(), 'components/GlobalSearch.tsx'), 'utf8')
    expect(layout).toContain('GlobalSearch')
    expect(search).toContain("e.key === 'k'")
    expect(search).toContain('v_matter_pipeline')
    expect(search).not.toContain('from(\'leads\')')
  })
})
