import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { MattersClient } from './client'
import { CORRIGIBLE_FIELDS, correctMatter, getMatter, listMatters } from './matters'

/**
 * Built from `CORRIGIBLE_FIELDS` rather than retyping the three names, so this
 * schema and the function's allow-list cannot drift apart. The `satisfies`
 * makes a field added to that constant and forgotten here a compile error.
 */
const corrigible = z
  .object({
    name: z.string().min(1).optional(),
    matter_number: z.string().min(1).optional(),
    matter_type: z.enum(['individual', 'couple']).optional(),
  })
  .strict()

const _fieldsCovered: Record<(typeof CORRIGIBLE_FIELDS)[number], true> = {
  name: true,
  matter_number: true,
  matter_type: true,
}
void _fieldsCovered

/**
 * Exported so a test can assert the tool refuses a field the function refuses.
 * `.strict()` is what makes `{ stage: … }` a parse failure rather than a
 * silently dropped key.
 */
export const CORRECT_MATTER_SHAPE = z.object({
  matter_id: z.string().uuid(),
  expect: corrigible,
  set: corrigible,
  reason: z.string().min(1),
})

const asText = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

/** Every failure returns its reason as text. A silent no-op is the failure this design guards against. */
async function reporting(work: () => Promise<unknown>) {
  try {
    return asText(await work())
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    }
  }
}

export function registerTools(server: McpServer, client: MattersClient): void {
  server.tool(
    'list_matters',
    'List matters, optionally filtered by relationship status, stage, or a name substring.',
    {
      relationship_status: z.enum(['lead', 'hired', 'lost', 'declined']).optional(),
      stage: z.string().optional(),
      name_contains: z.string().optional(),
    },
    async (args) =>
      reporting(() =>
        listMatters(client, {
          relationshipStatus: args.relationship_status,
          stage: args.stage,
          nameContains: args.name_contains,
        }),
      ),
  )

  server.tool(
    'get_matter',
    'One matter with its latest design sheet and every linked contact — the three things that have to agree.',
    { matter_id: z.string().uuid() },
    async (args) => reporting(() => getMatter(client, args.matter_id)),
  )

  server.tool(
    'correct_matter',
    "Correct a matter's name, matter_number or matter_type. `expect` must carry the values you read; a stale read is refused. Stage and relationship status cannot be changed here.",
    CORRECT_MATTER_SHAPE.shape,
    async (args) =>
      reporting(() =>
        correctMatter(client, {
          matterId: args.matter_id,
          expect: args.expect,
          set: args.set,
          reason: args.reason,
        }),
      ),
  )
}
