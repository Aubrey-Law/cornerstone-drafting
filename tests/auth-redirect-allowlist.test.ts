import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every host that signs a user in must be on Supabase's redirect allow-list,
 * as a pattern that tolerates a query string.
 *
 * Two separate failures live here, and the second one bit *after* the first was
 * fixed, so both are worth stating.
 *
 * **A missing host.** Supabase throws away the `redirect_to` the app asked for
 * and sends the browser to `site_url` instead. Sign-in *succeeds* and drops the
 * user into a different application, with nothing in any log. The workbench
 * shipped Google sign-in in #396 with no entry here, and every attempt landed
 * in the root app.
 *
 * **An exact host.** These are glob patterns, not prefixes. An entry of
 * `https://host/auth/callback` matches that URL and nothing else — a query
 * string included. Both apps append `?redirectTo=<path>` to the callback
 * whenever the visitor reached the login page by being bounced off a gated URL,
 * so an exact entry works when you navigate to `/auth/login` yourself and fails
 * when you arrive there any other way. Adding the workbench's exact callback
 * URL therefore fixed nothing, and the earlier version of this test passed
 * while production was still broken, because it asserted the exact string that
 * does not work.
 *
 * Measured against the live project on 2026-09-09, reading
 * `auth.flow_state.referrer`, which stores the redirect Supabase *validated*
 * (and stores `site_url` when it rejects one):
 *
 * | asked for | recorded |
 * | --- | --- |
 * | `…-20.vercel.app/auth/callback` | honoured |
 * | `…-20.vercel.app/auth/callback?redirectTo=%2F` | rejected |
 * | `cornerstone.aubreylegal.com/auth/callback?redirectTo=%2Fadmin` | honoured |
 * | `cornerstone.aubreylegal.com/zzz-not-a-real-path` | honoured |
 *
 * The last row is how the working shape was identified rather than guessed: the
 * root app's entry is a `/**` wildcard, so that is what the workbench needs.
 *
 * The dev ports are read from each app's own `dev` script rather than written
 * out, so moving a port moves this test with it instead of quietly leaving it
 * checking a port nobody serves.
 *
 * **What this test cannot do.** `supabase/config.toml` configures the *local*
 * stack; production is the hosted project's Authentication → URL Configuration,
 * which lives in the Supabase dashboard and which no test here can read. This
 * file is the written record of what that dashboard should say. Adding a host
 * here is half the fix; the other half is the dashboard.
 */

const root = join(__dirname, '..')

/** The suffix that makes an entry match any path and any query on its host. */
const WILDCARD = '/**'

function devPortOf(packageJsonPath: string): string {
  const pkg = JSON.parse(readFileSync(join(root, packageJsonPath), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const dev = pkg.scripts?.dev ?? ''
  const port = dev.match(/-p\s+(\d+)/)?.[1]
  if (!port) throw new Error(`No "-p <port>" in ${packageJsonPath}'s dev script: ${dev}`)
  return port
}

const allowList: string[] = (() => {
  const toml = readFileSync(join(root, 'supabase/config.toml'), 'utf8')
  const block = toml.match(/additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/)?.[1]
  if (!block) throw new Error('No additional_redirect_urls block in supabase/config.toml')
  return [...block.matchAll(/"([^"]+)"/g)].map(m => m[1])
})()

describe('the Supabase redirect allow-list', () => {
  it('covers the app’s dev server, on both loopback spellings', () => {
    const missing: string[] = []
    for (const pkg of ['package.json']) {
      const port = devPortOf(pkg)
      for (const host of ['localhost', '127.0.0.1']) {
        const entry = `http://${host}:${port}${WILDCARD}`
        if (!allowList.includes(entry)) missing.push(`${pkg} -> ${entry}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('covers the app’s production hosts', () => {
    // The retired workbench (cornerstone-drafting-20.vercel.app) is gone from
    // the local list; only the app's own hosts remain.
    expect(allowList).not.toContain(`https://cornerstone-drafting-20.vercel.app${WILDCARD}`)
    expect(allowList).toContain(`https://cornerstone-drafting.vercel.app${WILDCARD}`)
    expect(allowList).toContain(`https://cornerstone.aubreylegal.com${WILDCARD}`)
  })

  it('gives every entry a wildcard, so a ?redirectTo= query still matches', () => {
    // The defect this file exists for. An entry without the wildcard is not a
    // narrower version of the same rule — it is a rule that fails precisely
    // when the user was bounced to the login page, which is the common case.
    expect(allowList.filter(entry => !entry.endsWith(WILDCARD))).toEqual([])
  })

  it('wildcards a whole host, never a bare scheme or a path fragment', () => {
    // `https:/**` or `https://host/auth/**` would both satisfy the rule above
    // while meaning something quite different. Every entry must be an origin
    // followed by the wildcard and nothing else.
    const wrong = allowList.filter(
      entry => !/^https?:\/\/[^/]+\/\*\*$/.test(entry),
    )
    expect(wrong).toEqual([])
  })
})
