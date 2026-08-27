import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type ProxyOptions, type ServerOptions, type UserConfig } from 'vite'

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

export default defineConfig(async ({ command }): Promise<UserConfig> => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: PANE_PORT,
    strictPort: true,
    // Minting certs is a dev-server concern: doing it unconditionally makes a
    // production build install a CA into the OS keychain as a side effect.
    https: command === 'serve' ? await httpsOptions() : undefined,
    /**
     * Everything the pane talks to is same-origin, by way of this proxy.
     *
     * Two separate constraints force it. Word's WebView blocks mixed content,
     * so an HTTPS pane cannot fetch http://localhost:3002 at all; and Office
     * dialogs refuse a plain-HTTP URL, so the sign-in dialog cannot navigate
     * to the Cornerstone login page directly either. Proxying both `/api` and
     * `/auth` through the pane's own HTTPS origin solves both, and means no
     * CORS headers are needed on the Cornerstone side.
     *
     * `/_next` comes along because the proxied `/auth/*` pages are server-
     * rendered by Next and load their JS and CSS from there.
     *
     * Caveat: staff OAuth redirects back to Supabase's configured site URL
     * (port 3002), which lands outside the dialog. Use email + password in
     * dev. In production the pane is served by the Next app itself, so pane
     * and login genuinely share an origin and OAuth returns correctly.
     */
    proxy: Object.fromEntries(
      ['/api', '/auth', '/_next'].map((path) => [path, proxyToCornerstone()]),
    ),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        taskpane: resolve(import.meta.dirname, 'taskpane.html'),
        commands: resolve(import.meta.dirname, 'commands.html'),
      },
    },
  },
}))
