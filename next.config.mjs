import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// Sentry's Next plugin (release creation, source-map upload, debug-id
// injection, telemetry) runs in `runAfterProductionCompile` on every
// `next build`. Locally that's pure overhead — runtime error reporting is
// initialized independently from `instrumentation.ts` and the
// `sentry.*.config.ts` files, which only need `NEXT_PUBLIC_SENTRY_DSN`.
//
// We only opt into the build plugin when one of the following is true:
//   • `SENTRY_AUTH_TOKEN` is set (the upload would actually authenticate)
//   • `SENTRY_UPLOAD_SOURCEMAPS=1` is explicitly set
//   • Running on CI (`CI=1` or `VERCEL=1`) in production mode
//
// Otherwise we return the bare Next config and skip the post-compile work
// entirely.
const SENTRY_BUILD_PLUGIN_ENABLED =
  Boolean(process.env.SENTRY_AUTH_TOKEN) ||
  process.env.SENTRY_UPLOAD_SOURCEMAPS === '1' ||
  ((process.env.CI === '1' || process.env.CI === 'true' || process.env.VERCEL === '1') &&
    process.env.NODE_ENV === 'production');

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/admin/leads', destination: '/admin/crm/opportunities', permanent: true },
      { source: '/admin/leads/:path*', destination: '/admin/crm/opportunities/:path*', permanent: true },
      { source: '/admin/contacts', destination: '/admin/crm/people', permanent: true },
    ];
  },
  transpilePackages: ['@aubrey-law/estate-fields'],
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
      '@radix-ui/react-toggle',
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

      // Only print logs for uploading source maps in CI
      silent: !process.env.CI,

      // Skip telemetry pings unless we actually have an auth token to back
      // a real upload — keeps the post-compile hook idle in CI dry runs.
      telemetry: Boolean(process.env.SENTRY_AUTH_TOKEN),

      // Avoid uploading extra client source maps unless explicitly needed.
      widenClientFileUpload: process.env.SENTRY_WIDEN_CLIENT_FILE_UPLOAD === '1',

      // Route browser requests to Sentry through a Next.js rewrite to circumvent
      // ad-blockers. This can increase server load. Check that the configured
      // route will not match with the Next.js proxy, otherwise reporting of
      // client-side errors will fail.
      tunnelRoute: process.env.SENTRY_TUNNEL_ROUTE || undefined,

      // If somehow enabled without an auth token (e.g. CI dry run) we still
      // want to skip the actual upload/inject work to keep the hook short.
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },

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

export default withBundleAnalyzer(finalConfig);
