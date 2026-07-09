import { formatPhoneInput } from '@/lib/phone'

export interface ImportedLeadFiduciaryContact {
  name: string
  relationship: string
  address: string
  email: string
  phone: string
}

function emptyContact(overrides: Partial<ImportedLeadFiduciaryContact> = {}): ImportedLeadFiduciaryContact {
  return {
    name: '',
    relationship: '',
    address: '',
    email: '',
    ...overrides,
    phone: formatPhoneInput(overrides.phone ?? ''),
  }
}

function unescapeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .trim()
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (quoted && ch === '"' && next === '"') {
      cell += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if (!quoted && ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export function parseLeadFiduciaryContactImport(text: string): ImportedLeadFiduciaryContact[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  if (/BEGIN:VCARD/i.test(trimmed)) {
    return trimmed
      .split(/END:VCARD/i)
      .map((block) => {
        const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        const valueFor = (prefix: string) => {
          const upperPrefix = prefix.toUpperCase()
          const match = lines.find((line) => {
            const upperLine = line.toUpperCase()
            return upperLine.startsWith(`${upperPrefix}:`) || upperLine.startsWith(`${upperPrefix};`)
          })
          return match ? unescapeVCardValue(match.slice(match.indexOf(':') + 1)) : ''
        }
        const adr = valueFor('ADR')
          .split(';')
          .map(unescapeVCardValue)
          .filter(Boolean)
          .join(', ')
        return emptyContact({
          name: valueFor('FN') || valueFor('N').split(';').filter(Boolean).reverse().join(' '),
          email: valueFor('EMAIL'),
          phone: valueFor('TEL'),
          address: adr,
        })
      })
      .filter((contact) => contact.name || contact.email || contact.phone)
  }

  const rows = parseCsvRows(trimmed)
  if (rows.length > 1) {
    const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    const idx = (names: string[]) => headers.findIndex((header) => names.includes(header))
    const nameIdx = idx(['name', 'full_name', 'contact_name'])
    const firstIdx = idx(['first', 'first_name', 'given_name'])
    const lastIdx = idx(['last', 'last_name', 'family_name'])
    const relationshipIdx = idx(['relationship', 'relationship_to_client'])
    const addressIdx = idx(['address', 'mailing_address', 'street_address'])
    const emailIdx = idx(['email', 'email_address'])
    const phoneIdx = idx(['phone', 'phone_number', 'mobile'])

    if ([nameIdx, firstIdx, lastIdx, relationshipIdx, addressIdx, emailIdx, phoneIdx].some((i) => i >= 0)) {
      return rows.slice(1)
        .map((row) => emptyContact({
          name: nameIdx >= 0
            ? row[nameIdx] ?? ''
            : [firstIdx >= 0 ? row[firstIdx] : '', lastIdx >= 0 ? row[lastIdx] : ''].filter(Boolean).join(' '),
          relationship: relationshipIdx >= 0 ? row[relationshipIdx] ?? '' : '',
          address: addressIdx >= 0 ? row[addressIdx] ?? '' : '',
          email: emailIdx >= 0 ? row[emailIdx] ?? '' : '',
          phone: phoneIdx >= 0 ? row[phoneIdx] ?? '' : '',
        }))
        .filter((contact) => contact.name || contact.email || contact.phone)
    }
  }

  const fields = new Map<string, string>()
  trimmed.split(/\r?\n/).forEach((line) => {
    const [rawKey, ...rest] = line.split(':')
    if (!rawKey || rest.length === 0) return
    fields.set(rawKey.trim().toLowerCase(), rest.join(':').trim())
  })

  const contact = emptyContact({
    name: fields.get('name') ?? fields.get('full name') ?? '',
    relationship: fields.get('relationship') ?? '',
    address: fields.get('address') ?? '',
    email: fields.get('email') ?? '',
    phone: fields.get('phone') ?? '',
  })
  return contact.name || contact.email || contact.phone ? [contact] : []
}
