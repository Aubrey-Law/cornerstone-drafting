import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No destructive action asks through browser chrome.
 *
 * `window.confirm` and `window.prompt` were never only a styling problem. The
 * native dialog ignores the theme, cannot mark which button is the dangerous
 * one, and — the part that bites — both Chrome and Firefox offer "prevent this
 * page from creating more dialogs" after a couple of them, which turns every
 * later confirm into an instant false and every later prompt into an instant
 * null. On a page whose next question is "delete this asset?", a confirm that
 * answers itself is the wrong kind of quiet.
 *
 * Wave 3 moved ten of them onto the app's own dialog. This is the guard that
 * keeps the rest from coming back.
 */

const ROOT = join(__dirname, '..')

/**
 * The one file still calling a native dialog, with the reason it is allowed.
 *
 * It is fixed on the branch behind PR #515, which is blocked on the GitHub
 * Actions outage rather than on review. This list is asserted to be exactly
 * this file, so the moment #515 lands this test goes red and the entry has to
 * be deleted — an allowlist that cleans itself up rather than one that quietly
 * becomes permanent.
 */
const PENDING_ELSEWHERE = ['components/esign/SigningExperience.tsx']

function filesCallingNativeDialogs(): string[] {
  let out = ''
  try {
    out = execFileSync(
      'git',
      ['grep', '-l', '-E', String.raw`window\.(alert|confirm|prompt)\(`, '--', 'app', 'components', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    )
  } catch {
    // git grep exits 1 when nothing matches, which is the state we are aiming at.
    return []
  }
  return out
    .split('\n')
    .filter(Boolean)
    // The hook's own docblock explains what it replaces, and says the words.
    .filter(file => file !== 'components/useConfirm.tsx')
}

describe('native browser dialogs', () => {
  it('are not used for anything outside the documented exception', () => {
    expect(filesCallingNativeDialogs().sort()).toEqual([...PENDING_ELSEWHERE].sort())
  })

  it('has an allowlist that empties itself', () => {
    // If this fails because the list is empty, that is the good outcome: delete
    // PENDING_ELSEWHERE and this case, and keep the one above.
    expect(
      PENDING_ELSEWHERE.length,
      'PR #515 has landed — remove the allowlist and this test',
    ).toBeGreaterThan(0)
  })
})
