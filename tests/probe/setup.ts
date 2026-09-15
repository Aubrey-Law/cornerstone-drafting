import { config } from 'dotenv'

/**
 * Probes read the real environment, because talking to the real service is the
 * entire point. That is the opposite of the unit and integration setups, which
 * replace the environment so credentials cannot leak into assertions.
 *
 * `.env.test` is read first and wins, matching scripts/seedBrowserFixture.ts.
 * That ordering matters here: it means the worker credentials can be supplied
 * in `.env.test` without editing `.env.local`, which on some machines carries
 * quoting that stricter parsers reject. Both files are git-ignored.
 */
config({ path: '.env.test', override: false })
config({ path: '.env.local', override: false })

// Fail here rather than inside a test. A probe that skips when it is not
// configured is worse than no probe: the run goes green having checked nothing,
// which is the failure mode these are meant to close, not reproduce.
const workerUrl = process.env.DOCX_PDF_CONVERT_URL?.trim()

// `vercel env pull` cannot retrieve a variable marked Sensitive in Vercel —
// those are write-only by design. It writes this placeholder instead, so a
// pull-and-copy lands the literal string in .env.test and the probe sends it
// as a bearer token. The worker then answers 401, which reads as "wrong
// secret" rather than "no secret was ever retrieved". Caught by name, because
// the shape is indistinguishable from a short real value.
const REDACTED = '[SENSITIVE]'
for (const name of ['DOCX_PDF_CONVERT_URL', 'DOCX_PDF_CONVERT_SECRET']) {
  if (process.env[name]?.trim() === REDACTED) {
    throw new Error(
      `${name} is the literal string "${REDACTED}", not a value.\n`
        + 'That is what `vercel env pull` writes for a variable marked Sensitive in '
        + 'Vercel, which cannot be read back through the CLI, the API or the dashboard.\n'
        + 'Run the worker locally instead — it needs no secret:\n'
        + '  cd tools/docx-pdf-worker && npm install && npm start\n'
        + 'then set DOCX_PDF_CONVERT_URL=http://127.0.0.1:8080 and remove '
        + 'DOCX_PDF_CONVERT_SECRET from .env.test.',
    )
  }
}

if (!workerUrl) {
  throw new Error(
    'DOCX_PDF_CONVERT_URL is not set, so there is no convert worker to probe.\n'
      + 'Set it (and DOCX_PDF_CONVERT_SECRET if the worker requires one) in .env.test '
      + 'or .env.local. These are the same values the deployed app uses; `vercel env pull` '
      + 'is one way to get them.',
  )
}

// Check it parses here, where the variable can be named. convertDocxToPdf hands
// `${base}/convert` straight to fetch, which rejects a non-absolute URL with
// "Failed to parse URL from …" — and the runner masks env-derived values in that
// message, so the reader is told neither which variable nor what was wrong with
// it. A hostname pasted without its scheme is the easy way to land there.
try {
  const parsed = new URL(workerUrl)
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(`expected https, got "${parsed.protocol}"`)
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  throw new Error(
    `DOCX_PDF_CONVERT_URL is set but is not a usable absolute URL (${reason}).\n`
      + 'It needs the scheme, with no quotes and no trailing slash — for example:\n'
      + '  DOCX_PDF_CONVERT_URL=https://your-worker.fly.dev\n'
      + 'The value itself is not echoed here; check it in .env.test.',
  )
}
