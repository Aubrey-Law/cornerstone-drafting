import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// Runtime error reporting only needs the DSN and is initialized through the
// Next.js instrumentation entrypoints. The build plugin is solely for release
// creation and source-map upload, both of which require an authenticated Sentry
// token. Do not run it in a Vercel build without that credential: the upload
// cannot succeed and the plugin only emits misleading release warnings.
const SENTRY_BUILD_PLUGIN_ENABLED = Boolean(process.env.SENTRY_AUTH_TOKEN);

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/admin/leads', destination: '/admin/crm/opportunities', permanent: true },
      { source: '/admin/leads/:path*', destination: '/admin/crm/opportunities/:path*', permanent: true },
      { source: '/admin/contacts', destination: '/admin/crm/people', permanent: true },
      // Sync moved out of the CRM workspace into Settings; it has no children.
      { source: '/admin/crm/sync', destination: '/admin/settings/sync', permanent: true },
    ];
  },
  /**
   * The Word add-in pane, served out of `public/addin/`.
   *
   * Word's WebView caches add-in content hard enough that a cached bundle is
   * indistinguishable from a bug — the pane keeps running code that has already
   * been replaced. The dev server answers this by refusing to let anything be
   * cached; production cannot do that wholesale without re-downloading the
   * bundle on every open, so the split is by file:
   *
   * - the HTML entry points are never cached, so a deploy is picked up
   * - the assets beside them are content-hashed by Vite, so they are immutable
   *
   * Without the first rule an attorney who has opened the pane once keeps that
   * day's build, and `npm run clear-cache` is a developer command they do not
   * have.
   */
  async headers() {
    return [
      // Named one by one rather than matched by extension: these three are the
      // whole set (they are the `rollupOptions.input` of the add-in build), and
      // a literal source cannot be got wrong by a path-matching subtlety.
      ...['taskpane', 'dialog', 'commands'].map((page) => ({
        source: `/addin/${page}.html`,
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      })),
      // Content-hashed by Vite, so the name changes whenever the bytes do.
      // The unhashed ribbon icons live in /addin/assets/ and are deliberately
      // left out of this rule — they keep the default revalidating behaviour.
      {
        source: '/addin/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  transpilePackages: ['@aubrey-law/drafting-engine', '@aubrey-law/estate-fields'],
  outputFileTracingRoot: path.resolve(process.cwd()),
  // The engagement-agreement Word template and document-generation assets are
  // read at runtime via fs; keep them in the traced serverless function bundles.
  outputFileTracingIncludes: {
    '/api/admin/matters/[id]/draft': ['./tools/aubreylaw-docgeneration/**'],
    // Bundled system-workflow SKILL.md tree: synced into work_skills on demand
    // and read as the fallback prompt source by the chat/assistant routes.
    '/api/admin/works/sync-system': ['./tools/workflows/**'],
    '/api/admin/chat': ['./tools/workflows/**'],
    '/api/admin/assistant/chats/[chatId]/messages': ['./tools/workflows/**'],
    '/api/admin/engagement-agreements/[id]': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
    ],
    '/api/admin/engagement-agreements/[id]/preview': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
    ],
    // The native engine locates signature anchors by reading the rendered
    // PDF's text layer, so every route that approves, sends or seals an
    // agreement needs pdf.js and its fonts in its own bundle. `send` and
    // `sign` were missing: `send` locates anchors before creating the
    // envelope, and `sign` is where the signature is actually stamped — a
    // failure there is a client's failure, on a public route, with no
    // attorney watching.
    '/api/admin/engagement-agreements/[id]/approve': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
    ],
    '/api/admin/engagement-agreements/[id]/send': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
    ],
    // Sending an uploaded PDF appends a signature page, which reads the
    // upload's text layer to refuse a document that already carries these
    // markers, and then locates the anchors before anyone is emailed. Both go
    // through pdf.js.
    '/api/admin/matters/[id]/signature-requests': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
    ],
    '/api/sign/[token]': [
      './node_modules/@napi-rs/canvas*/**',
      './node_modules/pdfjs-dist/**',
      // The handwriting face a typed signature is stamped in, read from disk by
      // lib/esign/signatureFont.ts. nft would probably trace it anyway — it
      // evaluates that module's literal path.join(process.cwd(), …) — but that
      // holds only while the string stays literal, and this is the one route
      // where losing it silently downgrades a client's signature.
      './assets/fonts/NothingYouCouldDo-Regular.ttf',
    ],
  },
  // Keep the production build as a type-safety gate by default. If a constrained
  // runner needs to skip Next's in-build checker, set NEXT_IGNORE_TYPE_ERRORS=1
  // and keep `npm run typecheck` as a separate required CI/pre-deploy step.
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_TYPE_ERRORS === '1',
  },
  // Keep heavy server-only packages out of the client bundle
  serverExternalPackages: [
    'pdf-parse',
    '@napi-rs/canvas',
    // Not merely "heavy": packages/citations/src/textLayer/pdf.ts resolves
    // pdfjs-dist's own package.json to find its standard_fonts directory.
    // Bundled, webpack answers that resolve with a numeric module id, and the
    // path call downstream throws
    //   The "path" argument must be of type string. Received type number
    // which is what the first native engagement send failed on. External, the
    // resolve returns a real filesystem path.
    'pdfjs-dist',
    'mammoth',
    'docx',
    'pizzip',
    'nunjucks',
  ],
  experimental: {
    // Without a custom webpack config (Sentry plugin off locally), Next runs
    // webpack in a jest-worker child, which can deadlock before compiling on
    // some local setups. Set NEXT_DISABLE_WEBPACK_BUILD_WORKER=1 to compile
    // in-process instead; leave unset for the default (worker) behavior.
    webpackBuildWorker:
      process.env.NEXT_DISABLE_WEBPACK_BUILD_WORKER === '1' ? false : undefined,
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
  },
}

const finalConfig = SENTRY_BUILD_PLUGIN_ENABLED
  ? withSentryConfig(nextConfig, {
      // For all available options, see:
      // https://www.npmjs.com/package/@sentry/webpack-plugin#options

      org: 'aubrey-law',

      project: 'javascript-nextjs',

      authToken: process.env.SENTRY_AUTH_TOKEN,

      // Only print logs for uploading source maps in CI
      silent: !process.env.CI,

      telemetry: false,

      // Avoid uploading extra client source maps unless explicitly needed.
      widenClientFileUpload: process.env.SENTRY_WIDEN_CLIENT_FILE_UPLOAD === '1',

      // Route browser requests to Sentry through a Next.js rewrite to circumvent
      // ad-blockers. This can increase server load. Check that the configured
      // route will not match with the Next.js proxy, otherwise reporting of
      // client-side errors will fail.
      tunnelRoute: process.env.SENTRY_TUNNEL_ROUTE || undefined,

      webpack: {
        // Automatic instrumentation of Vercel Cron Monitors.
        // https://docs.sentry.io/product/crons/
        // https://vercel.com/docs/cron-jobs
        automaticVercelMonitors: process.env.VERCEL === '1',

        // Tree-shaking options for reducing bundle size.
        treeshake: {
          removeDebugLogging: true,
        },
      },
    })
  : nextConfig;

const analyzedConfig = withBundleAnalyzer(finalConfig);
// Browser-navigation investigations do not need the much larger server graph.
// Opt in with ANALYZE_TARGET=client; ordinary builds and full analysis are unchanged.
if (process.env.ANALYZE === 'true' && process.env.ANALYZE_TARGET === 'client') {
  const analyzeWebpack = analyzedConfig.webpack;
  analyzedConfig.webpack = (config, options) => {
    if (options.isServer) {
      return typeof finalConfig.webpack === 'function'
        ? finalConfig.webpack(config, options)
        : config;
    }
    return analyzeWebpack(config, options);
  };
}
export default analyzedConfig;
