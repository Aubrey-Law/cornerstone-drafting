import { afterEach, describe, expect, it, vi } from 'vitest'
import { dialogUrl } from '@/dialogUrl'

/**
 * The pane and the dialog are served from wherever Vite's `base` puts them:
 * the origin root under the dev server, `/addin/` in a build. Hardcoding
 * `/dialog.html` survived the move to a subpath silently and only failed in
 * production, where it resolved to a 404 and left Office opening an empty
 * dialog with nowhere for the OAuth round trip to return to.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dialogUrl', () => {
  it('sits at the origin root when that is where the pane is served', () => {
    vi.stubEnv('BASE_URL', '/')
    expect(dialogUrl('https://localhost:3100')).toBe('https://localhost:3100/dialog.html')
  })

  it('carries the base path when the pane is served under one', () => {
    vi.stubEnv('BASE_URL', '/addin/')
    expect(dialogUrl('https://cornerstone.aubreylegal.com')).toBe(
      'https://cornerstone.aubreylegal.com/addin/dialog.html',
    )
  })

  it('never doubles or drops the separating slash', () => {
    for (const base of ['/', '/addin/', '/nested/deep/']) {
      vi.stubEnv('BASE_URL', base)
      const url = dialogUrl('https://example.test')
      expect(url).toBe(`https://example.test${base}dialog.html`)
      expect(url).not.toContain('//dialog.html')
      expect(new URL(url).pathname).toBe(`${base}dialog.html`)
    }
  })
})
