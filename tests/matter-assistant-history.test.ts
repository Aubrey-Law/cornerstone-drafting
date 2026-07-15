import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

describe('matter assistant history', () => {
  it('loads the newest turns, not the oldest', () => {
    const source = read('lib/matterAssistantHistory.ts')
    expect(source).toContain('ascending: false')
    expect(source).toContain('.reverse()')
  })

  it('logs usage and exposes a turn-append handler', () => {
    const source = read('app/api/admin/matters/[id]/assistant/route.ts')
    expect(source).toContain('logAiUsage')
    expect(source).toContain('export async function PATCH')
  })

  it('caches the admin chat system prompt', () => {
    const source = read('lib/adminChat/engine.ts')
    expect(source).toContain('cache_control')
  })
})
