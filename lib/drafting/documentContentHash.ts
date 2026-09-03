import { createHash } from 'node:crypto'
import PizZip from 'pizzip'

/**
 * A stable fingerprint of a generated DOCX's *content*.
 *
 * A DOCX is a zip, and its entries carry modification timestamps, so two
 * renders of identical input produce different bytes seconds apart. Hashing the
 * file therefore proves nothing: an early attempt at a byte-level regression
 * gate passed only because both renders happened to land inside one timestamp
 * granularity, and reported a false green.
 *
 * This hashes what actually matters instead — every entry's name and its
 * decompressed bytes, in sorted order, ignoring zip metadata. Identical
 * documents hash identically no matter when they were rendered.
 */
export function documentContentHash(docx: Buffer | Uint8Array): string {
  const zip = new PizZip(docx)
  const hash = createHash('sha256')
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name]
    if (entry.dir) continue
    hash.update(name)
    hash.update(entry.asUint8Array())
  }
  return hash.digest('hex')
}
