import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every host that signs a user in must be on Supabase's redirect allow-list.
 *
 * This is not a style rule. A host that is missing does not fail loudly and
 * does not appear in any log: Supabase throws away the `redirect_to` the app
 * asked for and sends the browser to `site_url` instead. Sign-in *succeeds*
 * and drops the user into a different application. The workbench shipped
 * Google sign-in in #396 without an entry here, and every attempt to sign in
 * to the workbench landed in the root app until 2026-09-09.
 *
 * The dev ports are read from each app's own `dev` script rather than written
 * out, so moving a port moves this test with it instead of quietly making it
 * a check of a port nobody serves.
 *
 * **What this test cannot do.** `supabase/config.toml` configures the *local*
 * stack; production is the hosted project's Authentication → URL Configuration,
 * which lives in the Supabase dashboard and which no test here can read. This
 * file is the written record of what that dashboard should say. Adding a host
 * here is half the fix; the other half is the dashboard.
 */

const root = join(__dirname, '..')

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
  it('covers both apps’ dev servers, on both loopback spellings', () => {
    const missing: string[] = []
    for (const pkg of ['package.json', 'apps/workbench/package.json']) {
      const port = devPortOf(pkg)
      for (const host of ['localhost', '127.0.0.1']) {
        const url = `http://${host}:${port}/auth/callback`
        if (!allowList.includes(url)) missing.push(`${pkg} -> ${url}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('covers the workbench’s production host, not only the root app’s', () => {
    // Measured 2026-09-09: cornerstone-drafting-20.vercel.app serves "Sign in ·
    // Aubrey Law Workbench", and cornerstone-drafting.vercel.app serves the root
    // app. The Vercel project is named `cornerstone-drafting-2.0`; its default
    // domain drops the dot, which is the easiest of the two to leave out.
    expect(allowList).toContain('https://cornerstone-drafting-20.vercel.app/auth/callback')
    expect(allowList).toContain('https://cornerstone-drafting.vercel.app/auth/callback')
  })

  it('lists only /auth/callback URLs, which is the only path either app returns to', () => {
    // Both apps build the callback as `new URL('/auth/callback', origin)`. An
    // entry on any other path is either a typo or a host nobody returns to.
    expect(allowList.filter(url => !url.endsWith('/auth/callback'))).toEqual([])
  })
})
