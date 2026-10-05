import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// lib/estateClauses/persistGeneratedDocument.ts is deliberately absent: it writes
// through the persist_generated_estate_document RPC, whose INSERT relies on the
// matter_documents column defaults (source='firm', shared_at=NULL).
const WRITERS: Array<{ file: string; source: string }> = [
  { file: 'app/api/documents/upload/route.ts', source: "source: isAdmin ? 'firm' : 'client'" },
  { file: 'app/api/documents/[id]/convert-pdf/route.ts', source: "source: 'firm'" },
  // Signed engagement agreements are written by the shared completion module,
  // which both the webhook and in-process signing go through.
  { file: 'lib/esign/completion.ts', source: "source: 'firm'" },
  { file: 'app/api/admin/meeting-notes/route.ts', source: "source: 'meeting-notes'" },
  // Executed originals scanned in after the signing.
  { file: 'lib/signing/scanIn.ts', source: "source: 'firm'" },
  { file: 'lib/drafting/persistGeneratedDocument.ts', source: "source: 'firm'" },
  { file: 'lib/intake/promoteIntakeDocuments.ts', source: "source: 'client'" },
  { file: 'lib/works/artifacts.ts', source: "source: 'client'" },
  // A prior plan the client brought in, filed from its workbench review.
  { file: 'lib/documents/priorPlans.ts', source: "source: 'client'" },
]

describe('every matter_documents writer sets source', () => {
  for (const { file, source } of WRITERS) {
    it(`${file} sets ${source}`, () => {
      const contents = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(contents).toContain(source)
    })
  }
})
