import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('intake submission route review choices', () => {
  it('does not clear saved review choices when a status-only submit omits them', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/api/intake/route.ts'),
      'utf8',
    )

    expect(source).not.toContain('body.review_choices ?? null')
    expect(source.match(/review_choices:\s+body\.review_choices,/g)).toHaveLength(2)
  })
})
