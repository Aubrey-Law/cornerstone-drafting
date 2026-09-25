import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * Reading client documents out of R2.
 *
 * Read-only by design for now: this app reviews documents the drafting side
 * produced, and nothing here writes. When scan-and-file lands it will add a
 * put, and it should be a separate function so the read path stays obviously
 * incapable of overwriting a client's instrument.
 *
 * The client is built per call rather than memoised at module scope, because
 * this module is reachable from code Next evaluates at build time, where the
 * credentials are legitimately absent.
 */
export function getR2Client(): S3Client {
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
 * A function rather than a constant, and a hard failure in production rather
 * than a default. The old app learned this the expensive way: an unset variable
 * fell back to a bucket nobody chose while the deployment checklist named a
 * variable nothing read, so reads, writes and health checks could all address
 * the wrong place without a word. Outside production the default stands, so
 * tests and local work need no setup.
 */
export function r2Bucket(): string {
  const configured = process.env.R2_BUCKET_NAME?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'R2_BUCKET_NAME is not set. Refusing to fall back to a default bucket for client documents. ' +
        'Set R2_BUCKET_NAME in the Vercel project environment and redeploy.',
    )
  }
  return 'legal-documents'
}

/** The bytes of one stored object. */
export async function readObject(key: string): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: r2Bucket(), Key: key }),
  )
  if (!response.Body) throw new Error(`Storage returned no body for ${key}`)
  return Buffer.from(await response.Body.transformToByteArray())
}

/**
 * Stores bytes under `key`. The workbench writes one kind of object — an
 * unfiled upload kept so its review can be recorded (`lib/review/uploads.ts`);
 * filed documents are written by the root app, never from here.
 */
export async function writeObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: bytes, ContentType: contentType }),
  )
}

/** Removes an object the workbench wrote — used only to undo an upload whose row could not be recorded. */
export async function deleteObject(key: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }))
}
