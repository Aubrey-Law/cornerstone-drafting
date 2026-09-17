import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No destructive action asks through browser chrome. None are left.
 *
 * `window.confirm` and `window.prompt` were never only a styling problem. The
 * native dialog ignores the theme, cannot mark which button is the dangerous
 * one, and — the part that bites — both Chrome and Firefox offer "prevent this
 * page from creating more dialogs" after a couple of them, which turns every
 * later confirm into an instant false and every later prompt into an instant
 * null. On a page whose next question is "delete this asset?", a confirm that
 * answers itself is the wrong kind of quiet.
 *
 * They were also wrong in a way that cost more than looks. `prompt` answers
 * Cancel with null and an empty submit with '', both falsy, and every call site
 * here tested the result for truthiness — so on the client signing page,
 * pressing Cancel declined the agreement.
 *
 * Wave 3 moved ten onto the app's own dialog. The last four went with this
 * change and the one before it. This keeps them gone.
 */

const ROOT = join(__dirname, '..')

function filesCallingNativeDialogs(): string[] {
  let out = ''
  try {
    out = execFileSync(
      'git',
      ['grep', '-l', '-E', String.raw`window\.(alert|confirm|prompt)\(`, '--', 'app', 'components', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    )
  } catch {
    // git grep exits 1 when nothing matches, which is the state this asserts.
    return []
  }
  return out
    .split('\n')
    .filter(Boolean)
    // The hooks' own docblocks explain what they replace, and say the words.
    .filter(file => file !== 'components/useConfirm.tsx')
}

describe('native browser dialogs', () => {
  it('are not used anywhere in the app', () => {
    expect(filesCallingNativeDialogs()).toEqual([])
  })
})
