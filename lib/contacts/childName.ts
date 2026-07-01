/** Split a single display name into first/middle/last. Lossy by design;
 *  the contacts form is the high-fidelity structured entry point. */
export function splitName(full: string | null): { first: string; middle: string | null; last: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', middle: null, last: '' }
  if (parts.length === 1) return { first: parts[0], middle: null, last: '' }
  if (parts.length === 2) return { first: parts[0], middle: null, last: parts[1] }
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] }
}

/** Join structured names back into a display name. Empty → null. */
export function joinName(first: string | null, last: string | null): string | null {
  const combined = [first, last].map((p) => (p ?? '').trim()).filter(Boolean).join(' ')
  return combined || null
}
