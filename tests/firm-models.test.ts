import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('firm model defaults', () => {
  it('does not hardcode retired Anthropic model ids', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/firmModels.ts'), 'utf8')

    expect(source).not.toContain('claude-sonnet-4-20250514')
    expect(source).toContain('normalizeAnthropicModel')
    expect(source).toContain('DEFAULT_ANTHROPIC_MODEL')
  })
})
