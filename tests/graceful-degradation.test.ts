import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('graceful degradation banners', () => {
  it('uses SetupBanner for disabled comms on matter detail', () => {
    const detail = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/MatterDetailClient.tsx'), 'utf8')
    const banner = fs.readFileSync(path.join(process.cwd(), 'components/SetupBanner.tsx'), 'utf8')
    expect(detail).toContain('SetupBanner')
    expect(banner).toContain('/admin/settings')
  })
})
