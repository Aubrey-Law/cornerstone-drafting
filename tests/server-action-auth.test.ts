import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Server Actions are POST endpoints dispatched by the `Next-Action` header
 * against a global manifest. They are NOT scoped to the route path you POST to,
 * so the `/admin` prefix gate in proxy.ts does not protect them, and their
 * action IDs ship in the client bundle for any component that imports them.
 * Every action must therefore authorize its own caller.
 *
 * This existed as a gap: four actions in app/actions/adminIntake.ts reached the
 * RLS-bypassing service-role client with no auth check at all, while their
 * siblings in the same file were guarded.
 */

const ROOTS = ['app', 'lib', 'components']
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])

const GUARD_PATTERN =
  /requirePortalMessageMatter|requireAdminServerAction|requireEngagementStaff|requireAdmin\b|auth\.getUser\(\)|ADMIN_ROLES/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function serverActionFiles(): string[] {
  const files: string[] = []
  for (const root of ROOTS) {
    const abs = path.join(process.cwd(), root)
    if (!fs.existsSync(abs)) continue
    for (const file of walk(abs)) {
      const src = fs.readFileSync(file, 'utf8')
      // Must be the module-level directive, not an incidental string.
      if (/^\s*['"]use server['"]/.test(src)) files.push(path.relative(process.cwd(), file))
    }
  }
  return files.sort()
}

interface ExportedAction {
  file: string
  name: string
  body: string
}

function exportedActions(file: string): ExportedAction[] {
  const lines = fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\n')
  const starts: number[] = []
  lines.forEach((line, i) => {
    if (line.startsWith('export async function')) starts.push(i)
  })

  return starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length
    const body = lines.slice(start, end).join('\n')
    const name = /export async function (\w+)/.exec(body)?.[1] ?? '<anonymous>'
    return { file, name, body }
  })
}

describe('server action authorization', () => {
  it('finds the server action modules it is meant to police', () => {
    const files = serverActionFiles()
    // Guards against the walk silently matching nothing and the suite passing.
    expect(files).toContain('app/actions/adminIntake.ts')
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every exported server action authorizes its caller', () => {
    const unguarded = serverActionFiles()
      .flatMap(exportedActions)
      .filter(action => !GUARD_PATTERN.test(action.body))
      .map(action => `${action.file}:${action.name}`)

    expect(unguarded).toEqual([])
  })

  it('actions reaching the service-role client are admin-gated or reviewed', () => {
    // getAdminClient() bypasses RLS entirely, so a caller-supplied id is only
    // safe behind a staff-role check — or, for client-facing actions, behind an
    // ownership check performed with the RLS-scoped user client first.
    //
    // Anything client-facing must be listed here deliberately, with the reason
    // it is safe. A new entry is a signal to review, not a formality.
    const REVIEWED_CLIENT_FACING = new Map([
      ['app/(portal)/messages/actions.ts:acknowledgeMessages',
        'requirePortalMessageMatter rechecks authenticated intake ownership and matches the canonical matter before a service update constrained to that matter, displayed IDs, unread state and firm senders. Negative ownership tests are in portal-history-authorization.test.ts.'],
      [
        'app/intake/(shell)/actions.ts:requestIntakeUnlock',
        'Reads the intake through the RLS-scoped user client filtered to ' +
          'user_id/client_user_id, then touches the admin client only with the ' +
          'ownership-verified intake.id.',
      ],
    ])

    const offenders = serverActionFiles()
      .flatMap(exportedActions)
      .filter(action => /getAdminClient\(\)/.test(action.body))
      .filter(
        action =>
          !/requireAdminServerAction|requireEngagementStaff|ADMIN_ROLES/.test(action.body),
      )
      .map(action => `${action.file}:${action.name}`)
      .filter(id => !REVIEWED_CLIENT_FACING.has(id))

    expect(offenders).toEqual([])
  })
})
