import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type ProxyOptions, type ServerOptions, type UserConfig } from 'vite'

/** The pane's own port. 3002 is the Cornerstone Next dev server. */
const PANE_PORT = 3100
/** Where `/api/*` is proxied. Same-origin from the pane's point of view. */
const CORNERSTONE_ORIGIN = process.env.CORNERSTONE_ORIGIN ?? 'http://localhost:3002'

/**
 * Office refuses to load a task pane over plain HTTP, so the dev server must
 * serve HTTPS.
 *
 * `office-addin-dev-certs` mints a local CA and installs it into the OS
 * keychain, which raises an admin prompt no headless environment can answer.
 * DEV_HTTPS_CERT / DEV_HTTPS_KEY serve pre-existing files instead, so CI and
 * containers have a way in.
 */
async function httpsOptions(): Promise<ServerOptions['https']> {
  const cert = process.env.DEV_HTTPS_CERT
  const key = process.env.DEV_HTTPS_KEY
  if (cert && key) {
    return { cert: readFileSync(cert), key: readFileSync(key) }
  }
  const devCerts = await import('office-addin-dev-certs')
  const { ca, cert: c, key: k } = await devCerts.getHttpsServerOptions()
  return { ca, cert: c, key: k }
}


function proxyToCornerstone(): ProxyOptions {
  return {
    target: CORNERSTONE_ORIGIN,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyRes', (proxyRes) => {
        // Compression middleware buffers text/event-stream and turns the chat
        // reply into one blob at the end instead of a stream.
        const type = proxyRes.headers['content-type']
        if (typeof type === 'string' && type.includes('text/event-stream')) {
          delete proxyRes.headers['content-encoding']
        }
      })
    },
  }
}


/**
 * Refuse to ship a pane that cannot sign in.
 *
 * The sign-in dialog reads NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, and Vite inlines them at build time from the
 * repository root `.env` or, where there is no such file (Vercel), from the
 * process environment. When neither supplies them the build still succeeds and
 * emits `createClient(undefined, undefined)` — a pane that loads, renders, and
 * fails only when an attorney tries to sign in.
 *
 * Hard failure is scoped to a real deployment on purpose. CI builds this
 * project with no environment at all, and so does a fresh worktree; breaking
 * those would be noise. A production Vercel build is the one case where the
 * output reaches somebody.
 */
function assertSignInIsPossible(mode: string, envDir: string): void {
  const env = loadEnv(mode, envDir, ['VITE_', 'NEXT_PUBLIC_'])
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(
    (name) => !env[name],
  )
  if (missing.length === 0) return

  const detail = `the sign-in dialog needs ${missing.join(' and ')}`
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error(
      `Refusing to build the Word add-in without Supabase credentials: ${detail}. ` +
        'Set them on the Vercel project; the pane would otherwise deploy unable to sign anyone in.',
    )
  }
  console.warn(`[word-addin] building without Supabase credentials — ${detail}. Sign-in will not work.`)
}

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  const envDir = resolve(import.meta.dirname, '..')
  if (command === 'build') assertSignInIsPossible(mode, envDir)

  return {
  plugins: [react(), tailwindcss()],
  /**
   * Production is served by the Next app out of `public/addin/`, so a built
   * asset URL has to carry that prefix. Development is not: the dev server is
   * the origin root, `manifest.xml` points at `https://localhost:3100/taskpane.html`,
   * and prefixing there would 404 every sideloaded pane.
   *
   * Same origin either way — which is the point. Word's WebView blocks mixed
   * content, and sharing Cornerstone's origin in production is what keeps the
   * pane's `/api/addin/*` calls same-origin without any CORS handling, exactly
   * as the dev proxy does locally.
   */
  base: command === 'build' ? '/addin/' : '/',
  /**
   * An inline (empty) PostCSS config, which is what stops Vite searching for
   * one on disk.
   *
   * Tailwind reaches this project through `@tailwindcss/vite` above, so there
   * is no PostCSS step to configure. But the search walks *upward* from this
   * directory, and the parent is the Cornerstone repo root — whose
   * `postcss.config.mjs` loads `@tailwindcss/postcss`, a dependency of the Next
   * app that this nested project does not and should not install. Vite found
   * it, tried to require it from here, and `vite build` died on
   * `Cannot find module '@tailwindcss/postcss'`.
   *
   * Belongs with the exclusions pinned by `tests/word-addin-project.test.ts`:
   * same rule that the root build ignores the add-in, in the other direction.
   */
  css: { postcss: {} },
  /**
   * Stamped at server start / build time. The pane prints it, so a stale
   * bundle announces itself instead of being mistaken for broken code.
   */
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 19).replace('T', ' ')),
  },
  /**
   * Read the repository root's .env, not one of our own.
   *
   * The sign-in dialog needs the Supabase project URL and anon key. Those
   * already live at the root as NEXT_PUBLIC_SUPABASE_URL and
   * NEXT_PUBLIC_SUPABASE_ANON_KEY, and both are public by construction — the
   * Next app ships them to every browser that loads Cornerstone. Pointing Vite
   * at the same file, and widening the prefix to accept those names, means the
   * add-in needs no env setup of its own and cannot drift out of step with the
   * app it signs into.
   */
  envDir,
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: PANE_PORT,
    strictPort: true,
    /**
     * Word's WebView caches add-in content aggressively, and a cached bundle is
     * indistinguishable from a bug: the pane keeps running code you have
     * already changed, and no amount of reloading the dev server dislodges it.
     * Refusing to let anything be cached is the only reliable answer during
     * development.
     */
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
    // Minting certs is a dev-server concern: doing it unconditionally makes a
    // production build install a CA into the OS keychain as a side effect.
    https: command === 'serve' ? await httpsOptions() : undefined,
    /**
     * Everything the pane talks to is same-origin, by way of this proxy.
     *
     * Word's WebView blocks mixed content, so an HTTPS pane cannot fetch
     * http://localhost:3002 at all. Proxying `/api` through the pane's own
     * HTTPS origin solves that and means no CORS headers are needed on the
     * Cornerstone side.
     *
     * `/auth` and `/_next` used to be proxied too, so the sign-in dialog could
     * navigate to the Next login page. It no longer does: the dialog is served
     * from this dev server as `dialog.html` and talks to Supabase directly, so
     * none of Next's server-rendered pages are in the add-in's path. That also
     * retires the old caveat that staff OAuth redirected to Supabase's
     * configured site URL on port 3002 and landed outside the dialog.
     */
    proxy: { '/api': proxyToCornerstone() },
  },
  build: {
    /**
     * Straight into the Next app's `public/`, which Next copies into the
     * deployment and serves statically — no route handler, and nothing about
     * the add-in enters the Next module graph. `tests/word-addin-project.test.ts`
     * pins the isolation that makes that safe.
     *
     * `emptyOutDir` has to be explicit because the directory is outside this
     * project's root; Vite refuses to clear such a directory otherwise.
     */
    outDir: resolve(import.meta.dirname, '../public/addin'),
    emptyOutDir: true,
    /**
     * Content-hashed bundles go to `static/`, away from `assets/`.
     *
     * `public/assets/` holds the ribbon icons, which Vite copies verbatim and
     * does NOT hash. Left in one directory with the hashed bundles there is no
     * way to write a cache rule that is right for both: the bundles want
     * `immutable`, and a year-long immutable cache on `icon-32.png` means a
     * replaced icon never reaches anyone. Separating them lets `next.config.mjs`
     * cache each correctly.
     */
    assetsDir: 'static',
    rollupOptions: {
      input: {
        taskpane: resolve(import.meta.dirname, 'taskpane.html'),
        commands: resolve(import.meta.dirname, 'commands.html'),
        dialog: resolve(import.meta.dirname, 'dialog.html'),
      },
    },
  },
  }
})
