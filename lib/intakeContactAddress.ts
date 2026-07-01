/** Compose a single mailing line from structured wizard / fiduciary fields for `contacts.address_line1`. */
export function composedAddressOneLine(parts: {
  address?: unknown
  street?: unknown
  city?: unknown
  state?: unknown
  zip?: unknown
}): string | null {
  const trimmed =
    typeof parts.address === 'string' ? parts.address.trim() : ''
  if (trimmed) return trimmed
  const street = typeof parts.street === 'string' ? parts.street.trim() : ''
  const city = typeof parts.city === 'string' ? parts.city.trim() : ''
  const state = typeof parts.state === 'string' ? parts.state.trim() : ''
  const zip = typeof parts.zip === 'string' ? parts.zip.trim() : ''
  const line = [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(', ')
  return line.trim() ? line.trim() : null
}

/** Client wizard uses `street_address`; DB column is `address_line1`. */
export function wizardStreetLine(data: Record<string, unknown>): string {
  const s = typeof data.street_address === 'string' ? data.street_address.trim() : ''
  const a = typeof data.address_line1 === 'string' ? data.address_line1.trim() : ''
  return s || a
}
