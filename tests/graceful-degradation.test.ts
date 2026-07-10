import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('graceful degradation banners', () => {
  it('uses SetupBanner for disabled comms on matter detail', () => {
    const messages = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/tabs/messages.tsx'), 'utf8')
    const banner = fs.readFileSync(path.join(process.cwd(), 'components/SetupBanner.tsx'), 'utf8')
    expect(messages).toContain('SetupBanner')
    expect(banner).toContain('/admin/settings')
  })
})
