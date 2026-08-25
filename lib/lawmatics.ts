import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'

const AUTH_BASE = 'https://app.lawmatics.com'
const API_BASE = 'https://api.lawmatics.com'

export const LAWMATICS_TOKEN_COLUMNS = 'access_token, refresh_token, expires_at' as const

// Read the singleton Lawmatics token, refreshing it if it expires within 5 min.
// Returns null if Lawmatics is not connected (no token row).
export async function getValidToken(): Promise<{ access_token: string } | null> {
  const admin = getAdminClient()
  const { data: stored, error } = await admin
    .from('lawmatics_tokens')
    .select(LAWMATICS_TOKEN_COLUMNS)
    .eq('id', 'singleton')
    .maybeSingle()
  if (error) {
    console.error('lawmatics_tokens read error:', error.message)
    return null
  }
  if (!stored) return null

  const expiresAt = new Date(stored.expires_at).getTime()
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000
  if (needsRefresh && stored.refresh_token) {
    try {
      const fresh = await refreshAccessToken(stored.refresh_token)
      const expires_at = new Date(Date.now() + (fresh.expires_in ?? 3600) * 1000).toISOString()
      await admin.from('lawmatics_tokens').upsert({
        id: 'singleton',
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? stored.refresh_token,
        expires_at,
        updated_at: new Date().toISOString(),
      })
      return { access_token: fresh.access_token }
    } catch (e) {
      console.error('Lawmatics token refresh failed:', e)
    }
  }
  return { access_token: stored.access_token }
}

export function getAuthUrl(state?: string) {
  const params = new URLSearchParams({
    client_id: process.env.LAWMATICS_CLIENT_ID!,
    redirect_uri: process.env.LAWMATICS_REDIRECT_URI!,
    response_type: 'code',
    ...(state ? { state } : {}),
  })
  return `${AUTH_BASE}/oauth/authorize?${params}`
}

export async function exchangeCode(code: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.LAWMATICS_CLIENT_ID!,
    client_secret: process.env.LAWMATICS_CLIENT_SECRET!,
    redirect_uri: process.env.LAWMATICS_REDIRECT_URI!,
    code,
  })
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

export async function refreshAccessToken(refresh_token: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.LAWMATICS_CLIENT_ID!,
    client_secret: process.env.LAWMATICS_CLIENT_SECRET!,
    refresh_token,
  })
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

export async function createProspect(accessToken: string, fields: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zipcode?: string | null
  birthdate?: string | null
  marital_status?: string | null
}) {
  // Strip nulls — Lawmatics rejects null values for some fields
  const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ''))
  const res = await fetch(`${API_BASE}/v1/prospects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Lawmatics create prospect failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ data: { id: string } }>
}

export async function fetchAllMatters(accessToken: string) {
  const all: LawmaticsMatter[] = []
  let page = 1

  while (true) {
    const res = await fetch(`${API_BASE}/v1/prospects?page=${page}&per_page=25`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Matters API failed (${res.status}): ${body}`)
    }
    const json = await res.json()

    const items: LawmaticsMatter[] = Array.isArray(json) ? json : (json.data ?? [])

    if (items.length === 0) break
    all.push(...items)

    const totalPages: number = json.meta?.total_pages ?? (items.length < 25 ? page : page + 1)
    if (page >= totalPages) break
    page++
  }

  return all
}

export interface LawmaticsMatter {
  id: number | string
  name?: string
  status?: string
  description?: string
  created_at?: string
  updated_at?: string
  // Contact may be nested under different keys depending on Lawmatics version
  contact?: LawmaticsContact
  client?: LawmaticsContact
  prospect?: LawmaticsContact
  custom_fields?: Record<string, unknown>[]
  [key: string]: unknown
}

export interface LawmaticsContact {
  id?: number | string
  first_name?: string
  last_name?: string
  name?: string
  email?: string
  phone?: string
  phone_numbers?: { number: string; label?: string }[]
  date_of_birth?: string
  dob?: string
  address?: LawmaticsAddress
  addresses?: LawmaticsAddress[]
  [key: string]: unknown
}

export interface LawmaticsAddress {
  street?: string
  address1?: string
  city?: string
  state?: string
  zip?: string
  zip_code?: string
  postal_code?: string
}

const LEGAL_PLAN_NAMES = ['arag', 'metlife', 'legalease', 'legal ease']
// Mirrors MARITAL_STATUS_OPTIONS (packages/estate-fields) — the vocabulary
// every intake/design surface reads.
const VALID_CLIENT_INTAKE_MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'separated', 'domestic partner', 'civil union', 'unmarried partnership'] as const

export function normalizeLawmaticsMaritalStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().trim().replace(/[_-]+/g, ' ')
  if (!normalized) return null
  if (normalized === 'domestic partnership' || normalized === 'partnered') return 'domestic_partner'
  if (!VALID_CLIENT_INTAKE_MARITAL_STATUSES.includes(normalized as typeof VALID_CLIENT_INTAKE_MARITAL_STATUSES[number])) {
    return null
  }
  // Stored values use underscores ('domestic_partner'); matching is on spaces.
  return normalized.replace(/ /g, '_')
}

// Extract legal plan from custom fields or tags
function extractLegalPlan(a: Record<string, unknown>): string | null {
  // Check custom_field_613309 directly on attributes
  const cf = a['custom_field_613309'] as string | undefined
  if (cf?.trim()) return cf.trim()

  // Check custom_fields array
  const customFields = a.custom_fields as Array<{ name?: string; label?: string; value?: unknown; code?: string }> | undefined
  if (Array.isArray(customFields)) {
    for (const f of customFields) {
      if (f.code === 'custom_field_613309' || f.name === 'Legal Plan Name' || f.label === 'Legal Plan Name') {
        const v = String(f.value ?? '').trim()
        if (v) return v
      }
    }
  }

  // Fall back to tags array
  const tags = a.tags as Array<{ name?: string } | string> | undefined
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const name = (typeof tag === 'string' ? tag : tag.name ?? '').toLowerCase()
      if (LEGAL_PLAN_NAMES.some(p => name.includes(p))) {
        return typeof tag === 'string' ? tag : (tag.name ?? null)
      }
    }
  }

  return null
}

// Fetch relationships for a prospect by scanning recent relationship pages
// Returns contact details (name, phone, relationship type) for each linked contact
export async function fetchProspectRelationships(
  accessToken: string,
  prospectId: string,
): Promise<{ name: string; phone: string; relationship: string }[]> {
  // Scan up to 3 pages (75 relationships, covering several months of recent activity)
  const matched: { name: string; contact_id: string; relationship: string }[] = []

  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://api.lawmatics.com/v1/relationships?per_page=25&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) break
    const json = await res.json()
    const rels = (json.data ?? []) as Record<string, unknown>[]
    for (const rel of rels) {
      const a = (rel.attributes ?? {}) as Record<string, unknown>
      if (String(a.prospect_id) === String(prospectId)) {
        matched.push({ name: String(a.name ?? 'Contact'), contact_id: String(a.contact_id), relationship: String(a.name ?? 'Contact') })
      }
    }
    const totalPages: number = json.meta?.total_pages ?? 1
    if (page >= totalPages) break
  }

  if (!matched.length) return []

  // Fetch contact details in parallel
  const contacts = await Promise.all(matched.map(async (m) => {
    const res = await fetch(`https://api.lawmatics.com/v1/contacts/${m.contact_id}?fields=all`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const json = await res.json()
    const a = (json.data?.attributes ?? {}) as Record<string, unknown>
    const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || (a.name as string) || ''
    if (!name) return null
    return { name, phone: formatPhoneDisplay((a.phone as string) || ''), relationship: m.relationship }
  }))

  return contacts.filter((c): c is { name: string; phone: string; relationship: string } => c !== null)
}

// Search Lawmatics prospects by name/email/phone (top 10 matches)
// Mirrors the search in app/api/lawmatics/pull GET so import-lead can reuse it.
export interface LawmaticsSummary {
  lm_id: string
  full_name: string | null
  phone: string | null
  email: string | null
}

export async function searchProspects(
  accessToken: string,
  query: string,
  opts?: { perPage?: number; maxPages?: number; max?: number },
): Promise<LawmaticsSummary[]> {
  const perPage = opts?.perPage ?? 100
  const maxPages = opts?.maxPages ?? 20
  const max = opts?.max ?? 10
  const qLower = query.trim().toLowerCase()
  const qDigits = query.replace(/\D/g, '')
  const matches: LawmaticsSummary[] = []
  let page = 1
  while (page <= maxPages) {
    const res = await fetch(`${API_BASE}/v1/prospects?per_page=${perPage}&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Lawmatics prospects search failed (${res.status}): ${text.slice(0, 200)}`)
    }
    const json = await res.json()
    const rows: Record<string, unknown>[] = json?.data ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const a = (r.attributes ?? {}) as Record<string, unknown>
      const full_name = [a.first_name, a.last_name].filter(Boolean).join(' ') || null
      const phone = formatPhoneDisplay((a.phone as string) ?? null) || null
      const email = (a.email as string) ?? null
      const matches_name = full_name?.toLowerCase().includes(qLower)
      const matches_email = email?.toLowerCase().includes(qLower)
      const matches_phone = qDigits.length >= 4 && phone?.replace(/\D/g, '').includes(qDigits)
      if (matches_name || matches_email || matches_phone) {
        matches.push({ lm_id: String(r.id), full_name, phone, email })
      }
    }
    if (matches.length >= max) break
    const totalPages: number = json.meta?.total_pages ?? (rows.length < perPage ? page : page + 1)
    if (page >= totalPages) break
    page++
  }
  return matches.slice(0, max)
}

// Search Lawmatics standalone contacts (separate resource from prospects).
export async function searchContacts(
  accessToken: string,
  query: string,
  opts?: { perPage?: number; maxPages?: number; max?: number },
): Promise<LawmaticsSummary[]> {
  const perPage = opts?.perPage ?? 100
  const maxPages = opts?.maxPages ?? 20
  const max = opts?.max ?? 10
  const qLower = query.trim().toLowerCase()
  const qDigits = query.replace(/\D/g, '')
  const matches: LawmaticsSummary[] = []
  let page = 1
  while (page <= maxPages) {
    const res = await fetch(`${API_BASE}/v1/contacts?per_page=${perPage}&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Lawmatics contacts search failed (${res.status}): ${text.slice(0, 200)}`)
    }
    const json = await res.json()
    const rows: Record<string, unknown>[] = json?.data ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const a = (r.attributes ?? {}) as Record<string, unknown>
      const full_name =
        [a.first_name, a.last_name].filter(Boolean).join(' ') ||
        (a.name as string) ||
        null
      const phone = formatPhoneDisplay((a.phone as string) ?? null) || null
      const email = (a.email as string) ?? null
      const matches_name = full_name?.toLowerCase().includes(qLower)
      const matches_email = email?.toLowerCase().includes(qLower)
      const matches_phone = qDigits.length >= 4 && phone?.replace(/\D/g, '').includes(qDigits)
      if (matches_name || matches_email || matches_phone) {
        matches.push({ lm_id: String(r.id), full_name, phone, email })
      }
    }
    if (matches.length >= max) break
    const totalPages: number = json.meta?.total_pages ?? (rows.length < perPage ? page : page + 1)
    if (page >= totalPages) break
    page++
  }
  return matches.slice(0, max)
}

// Map a Lawmatics contact's attributes to columns of our `contacts` table.
export function contactToContactRow(
  attrs: Record<string, unknown>,
): {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
} {
  const first_name = (attrs.first_name as string) || null
  const last_name = (attrs.last_name as string) || null
  return {
    first_name,
    last_name,
    email: (attrs.email as string) || null,
    phone: formatPhoneForStorage(attrs.phone as string),
    address_line1:
      (attrs.street as string) ||
      (attrs.address as string) ||
      (attrs.address1 as string) ||
      null,
    city: (attrs.city as string) || null,
    state: (attrs.state as string) || null,
    zip: (attrs.zip as string) || (attrs.zipcode as string) || (attrs.zip_code as string) || null,
  }
}

// Fetch the prospect's own contact record given a known contact_id
// Returns contact attributes (birthdate, street, city, state, zipcode, marital_status, etc.)
export async function fetchContactById(
  accessToken: string,
  contactId: string | number,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.lawmatics.com/v1/contacts/${contactId}?fields=all`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const json = await res.json()
  return (json.data?.attributes ?? {}) as Record<string, unknown>
}

// Parse sideloaded contacts from a Lawmatics JSON:API response
// Contacts appear in `included` array when fetched with ?include=contacts
export function parseIncludedContacts(
  jsonData: Record<string, unknown>,
): { name: string; phone: string; relationship: string }[] {
  const included = (jsonData.included ?? []) as Record<string, unknown>[]
  const data = (jsonData.data ?? {}) as Record<string, unknown>

  // Build a map of contact id → attributes from the included array
  const contactMap = new Map<string, Record<string, unknown>>()
  for (const item of included) {
    const itemType = (item.type as string ?? '').toLowerCase()
    if (itemType === 'contact' || itemType === 'contacts') {
      contactMap.set(String(item.id), (item.attributes ?? item) as Record<string, unknown>)
    }
  }

  // Get relationship metadata from data.relationships.contacts.data
  const relRefs = ((data.relationships as Record<string, unknown>)?.contacts as Record<string, unknown>)?.data as Record<string, unknown>[] ?? []

  const results: { name: string; phone: string; relationship: string }[] = []

  for (const ref of relRefs) {
    const id = String(ref.id)
    const meta = (ref.meta ?? {}) as Record<string, unknown>
    const attrs = contactMap.get(id) ?? {}
    const name = [attrs.first_name, attrs.last_name].filter(Boolean).join(' ') || (attrs.name as string) || ''
    if (!name) continue
    const phone = formatPhoneDisplay((attrs.phone as string) || '')
    const relationship = (meta.relationship_type as string) || (meta.contact_type as string) || (attrs.relationship_type as string) || 'Contact'
    results.push({ name, phone, relationship })
  }

  // If no relationship refs found but we have contacts in included, use those directly
  if (!results.length && contactMap.size > 0) {
    for (const attrs of Array.from(contactMap.values())) {
      const name = [attrs.first_name, attrs.last_name].filter(Boolean).join(' ') || (attrs.name as string) || ''
      if (!name) continue
      results.push({ name, phone: formatPhoneDisplay((attrs.phone as string) || ''), relationship: (attrs.relationship_type as string) || 'Contact' })
    }
  }

  return results
}

// Extract spouse_name and other_individuals from embedded relationship data in prospect attributes
function extractEmbeddedRelationships(a: Record<string, unknown>): {
  spouse_name: string | null
  other_individuals: { name: string; phone: string; address: string; relationship: string }[]
} {
  let spouse_name: string | null = (a.spouse_name as string) || null
  const other_individuals: { name: string; phone: string; address: string; relationship: string }[] = []

  const rels = a.contact_relationships ?? a.relationships ?? a.contacts
  if (!Array.isArray(rels)) return { spouse_name, other_individuals }

  for (const rel of rels as Record<string, unknown>[]) {
    const ra = (rel.attributes ?? rel) as Record<string, unknown>
    const contact = (ra.contact ?? ra.related_contact ?? ra) as Record<string, unknown>
    const ca = (contact.attributes ?? contact) as Record<string, unknown>
    const name = [ca.first_name ?? ra.first_name, ca.last_name ?? ra.last_name]
      .filter(Boolean).join(' ') || (ca.name as string) || ''
    if (!name) continue
    const phone = formatPhoneDisplay((ca.phone as string) || '')
    const relType = ((ra.relationship_type ?? ra.contact_type ?? ra.type ?? '') as string)
    const relLower = relType.toLowerCase()
    if (relLower.includes('spouse') || relLower.includes('partner') || relLower.includes('husband') || relLower.includes('wife')) {
      if (!spouse_name) spouse_name = name
    } else {
      other_individuals.push({ name, phone, address: '', relationship: relType || 'Other' })
    }
  }
  return { spouse_name, other_individuals }
}

// JSON:API format — fields are under record.attributes
export function matterToIntake(
  record: LawmaticsMatter,
  fetchedRelationships?: { name: string; phone: string; relationship: string }[],
  clientContact?: Record<string, unknown> | null,
): Record<string, unknown> {
  const a = (record.attributes ?? {}) as Record<string, unknown>
  const c = clientContact ?? {}

  const fullName =
    ([a.first_name, a.last_name].filter(Boolean).join(' ') || null) as string | null

  // Extract spouse + others from embedded relationship data
  const embedded = extractEmbeddedRelationships(a)

  // If fetched relationships were supplied, merge them in
  let spouse_name = embedded.spouse_name || (a.spouse_name as string) || null
  const other_individuals = [...embedded.other_individuals]

  if (fetchedRelationships?.length) {
    for (const r of fetchedRelationships) {
      const relLower = r.relationship.toLowerCase()
      if (relLower.includes('spouse') || relLower.includes('partner') || relLower.includes('husband') || relLower.includes('wife')) {
        if (!spouse_name) spouse_name = r.name
      } else {
        const alreadyPresent = other_individuals.some(o => o.name === r.name)
        if (!alreadyPresent) {
          other_individuals.push({ name: r.name, phone: r.phone, address: '', relationship: r.relationship })
        }
      }
    }
  }

  const actualValue = a.actual_value
  const matterFee = actualValue != null && actualValue !== '' ? Number(actualValue) : null

  return {
    lawmatics_matter_id: String(record.id),
    full_name: fullName,
    email: (a.email as string) || (c.email as string) || null,
    phone: formatPhoneForStorage((a.phone as string) || (c.phone as string) || null),
    date_of_birth: (a.date_of_birth as string) || (a.dob as string) || (c.birthdate as string) || null,
    address_line1: (a.street as string) || (a.address as string) || (c.street as string) || null,
    city: (a.city as string) || (c.city as string) || null,
    state: (a.state as string) || (c.state as string) || null,
    zip: (a.zip as string) || (a.zip_code as string) || (c.zipcode as string) || null,
    marital_status: normalizeLawmaticsMaritalStatus(a.marital_status || c.marital_status),
    spouse_name,
    other_individuals: other_individuals.length ? other_individuals : undefined,
    special_notes: (a.description as string) || (a.notes as string) || null,
    legal_plan: extractLegalPlan(a),
    campaign: (a.campaign as string) || null,
    matter_fee: Number.isFinite(matterFee) ? matterFee : null,
    case_number: (a.case_number as string) || null,
    status: 'in_progress',
    updated_at: (a.updated_at as string) || new Date().toISOString(),
  }
}
