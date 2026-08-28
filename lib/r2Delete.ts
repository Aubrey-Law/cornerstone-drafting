import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client, r2Bucket } from '@/lib/r2'

/** Best-effort delete of a single R2 object; logs and swallows errors (orphans are tolerable). */
export async function deleteR2Key(key: string | null | undefined) {
  if (!key?.trim()) return
  try {
    await getR2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }))
  } catch (e) {
    console.error('R2 delete failed (orphaned object):', key, e)
  }
}
