import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('matter activity redesign', () => {
  it('groups events by day and links stable document references', () => {
    const activity = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/MatterActivityTab.tsx'),
      'utf8',
    )

    expect(activity).toContain('groupActivityByDay')
    expect(activity).toContain('Generated ')
    expect(activity).toContain('documentRefs')
    expect(activity).toContain('?tab=documents&document=')
    expect(activity).toContain('max-w-[70ch]')
  })

  it('returns IDs from both draft persistence branches while keeping filenames', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/draft/route.ts'),
      'utf8',
    )
    const generate = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/GenerateStep.tsx'),
      'utf8',
    )

    expect(route).toContain('documentRefs')
    expect(route).toContain('persisted.documentId')
    expect(route).toContain('insertedDoc.id')
    expect(route).toContain('documents: uploadedFilenames')
    expect(generate).toContain('documentRefs')
  })
})
