import { S3Client } from '@aws-sdk/client-s3'

export function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

/**
 * The bucket holding client documents.
 *
 * This used to be a module-level constant defaulting to 'legal-documents', and
 * VERCEL_ENV_CHECKLIST.md told operators to set `R2_BUCKET` — a name nothing
 * reads. An operator who followed the checklist got the silent default instead,
 * so uploads, reads and health checks could all address a bucket nobody chose.
 *
 * In production an unset bucket is now a hard failure. It is deliberately a
 * function rather than a constant so that failure happens when a request tries
 * to use storage, not when the module is first imported: a module-load throw
 * would take out `next build`, which evaluates route modules with NODE_ENV set
 * to production. Outside production the old default still applies so local work
 * and tests need no extra configuration.
 */
export function r2Bucket(): string {
  const configured = process.env.R2_BUCKET_NAME?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'R2_BUCKET_NAME is not set. Refusing to fall back to a default bucket for client documents. '
        + 'Set R2_BUCKET_NAME in the Vercel project environment and redeploy.',
    )
  }
  return 'legal-documents'
}
