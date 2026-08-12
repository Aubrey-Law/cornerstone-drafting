import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'

/**
 * Secondary ways to reach a person — a work email beside the personal one, a
 * mobile beside the landline. Stored as JSONB on `client_intake` and `contacts`
 * (see 20260914000000_contact_additional_channels.sql); the primary `email` and
 * `phone` columns are untouched and still decide what a send defaults to.
 *
 * Every writer normalizes through here so a value the panel shows, the composer
 * offers and the database holds are the same string.
 */
export interface ContactChannel {
  /** What the address is for — "Work", "Mobile". Optional and free-form. */
  label: string
  value: string
}

export type ContactChannelKind = 'email' | 'phone'

/** Matches the array cap in the column's check constraint. */
export const MAX_ADDITIONAL_CHANNELS = 6

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

/**
 * Read whatever is on the row into channels. Tolerates a bare string array so
 * a hand-written or imported value still renders rather than throwing.
 */
export function parseContactChannels(raw: unknown): ContactChannel[] {
  if (!Array.isArray(raw)) return []
  const channels: ContactChannel[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const value = entry.trim()
      if (value) channels.push({ label: '', value })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const value = typeof record.value === 'string' ? record.value.trim() : ''
    if (!value) continue
    channels.push({
      label: typeof record.label === 'string' ? record.label.trim() : '',
      value,
    })
  }
  return channels.slice(0, MAX_ADDITIONAL_CHANNELS)
}

export class ContactChannelError extends Error {}

/**
 * Validate and canonicalize a list on its way to the database.
 *
 * Emails are lower-cased, phones are stored in the same shape the primary
 * column uses, and anything equal to the primary value is dropped: a duplicate
 * of the address already on the row is noise in every list that reads these.
 *
 * @throws ContactChannelError on an unusable entry, so the route answers 400
 *   rather than silently discarding what the operator typed.
 */
export function normalizeContactChannels(
  raw: unknown,
  kind: ContactChannelKind,
  primary?: string | null,
): ContactChannel[] {
  if (raw === null || raw === undefined) return []
  if (!Array.isArray(raw)) throw new ContactChannelError('Additional contacts must be a list')

  const primaryKey = primary ? channelKey(primary, kind) : null
  const seen = new Set<string>()
  const normalized: ContactChannel[] = []

  for (const entry of parseContactChannels(raw)) {
    const value = kind === 'email'
      ? entry.value.trim().toLowerCase()
      : formatPhoneForStorage(entry.value) ?? ''
    if (!value) continue
    if (kind === 'email' && !isEmailAddress(value)) {
      throw new ContactChannelError(`"${entry.value}" is not a valid email address`)
    }
    if (kind === 'phone' && value.replace(/\D/g, '').length < 10) {
      throw new ContactChannelError(`"${entry.value}" is not a valid phone number`)
    }
    const key = channelKey(value, kind)
    if (key === primaryKey || seen.has(key)) continue
    seen.add(key)
    normalized.push({ label: entry.label.slice(0, 40), value })
  }

  if (normalized.length > MAX_ADDITIONAL_CHANNELS) {
    throw new ContactChannelError(`At most ${MAX_ADDITIONAL_CHANNELS} additional entries are allowed`)
  }
  return normalized
}

/** Comparison key — case for emails, digits for phones. */
function channelKey(value: string, kind: ContactChannelKind): string {
  return kind === 'email' ? value.trim().toLowerCase() : value.replace(/\D/g, '')
}

export interface AlternateEmailOption {
  label: string
  email: string
}

/**
 * The addresses a composer can offer beside the one it opens with: each
 * person's primary address (the spouse's, typically) followed by whatever
 * extras they carry.
 *
 * A channel with no label of its own borrows the person's, so two unlabelled
 * extras never render as two identical buttons; `exclude` drops the address the
 * composer already put in the To field.
 */
export function buildAlternateEmails(
  people: { person: string; primary?: string | null; additional?: unknown }[],
  exclude: string | null,
): AlternateEmailOption[] {
  const seen = new Set<string>()
  const excluded = exclude?.trim().toLowerCase()
  if (excluded) seen.add(excluded)

  const options: AlternateEmailOption[] = []
  const push = (label: string, email: string) => {
    const key = email.trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    options.push({ label, email: email.trim() })
  }

  for (const { person, primary, additional } of people) {
    if (primary?.trim()) push(person, primary)
    for (const channel of parseContactChannels(additional)) {
      push(channel.label ? `${person} · ${channel.label}` : person, channel.value)
    }
  }
  return options
}

/** How a channel reads in a list: "Work · (555) 555-5555". */
export function formatContactChannel(channel: ContactChannel, kind: ContactChannelKind): string {
  const value = kind === 'phone' ? formatPhoneDisplay(channel.value) || channel.value : channel.value
  return channel.label ? `${channel.label} · ${value}` : value
}
