/**
 * The trail for the admin shell header, derived from the pathname alone.
 *
 * Breadcrumbs earn their place on deep routes and are noise on shallow ones: on
 * `/admin/tasks` the sidebar already highlights Tasks and the page already says
 * "Tasks", so a one-item trail would repeat the answer twice. This returns an
 * empty array below two entries and the header renders nothing, which is what
 * the eleven top-level pages get.
 *
 * Kept pure and separate from the shell so the mapping can be asserted directly
 * rather than through a rendered layout.
 */

export interface Crumb {
  label: string
  /** Absent on the last crumb — you are already there. */
  href?: string
}

/**
 * Where a route's section starts. Matched longest-prefix-first, so
 * `/admin/crm/opportunities` wins over `/admin/crm`.
 *
 * `href` is where the section's own index lives, which is not always the
 * prefix: Matters lives under `/admin/matters` but its list is at
 * `/admin/matters/list`. Sections with no index page (engagements) omit it and
 * render as plain text.
 *
 * `record` is the noun to show for an id segment when nothing has resolved its
 * real name yet — a raw UUID in a breadcrumb is worse than no breadcrumb.
 */
const SECTIONS: { prefix: string; label: string; href?: string; record: string }[] = [
  { prefix: '/admin/crm/opportunities', label: 'Leads', href: '/admin/crm/opportunities', record: 'Lead' },
  { prefix: '/admin/crm', label: 'CRM', href: '/admin/crm', record: 'Record' },
  { prefix: '/admin/matters', label: 'Matters', href: '/admin/matters/list', record: 'Matter' },
  { prefix: '/admin/drafting', label: 'Drafting', href: '/admin/drafting', record: 'Matter' },
  { prefix: '/admin/review', label: 'Reviews', href: '/admin/review', record: 'Review' },
  { prefix: '/admin/playbooks', label: 'Playbooks', href: '/admin/playbooks', record: 'Playbook' },
  { prefix: '/admin/field-audits', label: 'Field audits', href: '/admin/field-audits', record: 'Run' },
  { prefix: '/admin/funding', label: 'Funding', href: '/admin/funding', record: 'Matter' },
  { prefix: '/admin/fiduciaries', label: 'Fiduciaries', href: '/admin/fiduciaries', record: 'Matter' },
  { prefix: '/admin/billing', label: 'Billing', href: '/admin/billing', record: 'Invoice' },
  { prefix: '/admin/leads', label: 'Leads', href: '/admin/crm/opportunities', record: 'Lead' },
  { prefix: '/admin/settings', label: 'Settings', href: '/admin/settings', record: 'Record' },
  { prefix: '/admin/contacts', label: 'Contacts', href: '/admin/contacts', record: 'Contact' },
  { prefix: '/admin/pipeline', label: 'Pipeline', record: 'Record' },
  { prefix: '/admin/assistant', label: 'Assistant', href: '/admin/assistant', record: 'Chat' },
  { prefix: '/admin/engagements', label: 'Engagements', record: 'Agreement' },
  { prefix: '/admin/calendar', label: 'Calendar', href: '/admin/calendar', record: 'Event' },
  { prefix: '/admin/tasks', label: 'Tasks', href: '/admin/tasks', record: 'Task' },
  { prefix: '/admin/works', label: 'Library', href: '/admin/works', record: 'Work' },
]

/**
 * Segments whose label is not just their slug title-cased. Everything not named
 * here falls through to `humanize`, so a new route gets a readable crumb
 * without this file being touched.
 */
const SEGMENT_LABELS: Record<string, string> = {
  activities: 'Activities',
  aging: 'Aging',
  chat: 'Chat',
  design: 'Design sheet',
  edit: 'Edit',
  'estate-tax': 'Estate tax',
  invoices: 'Invoices',
  list: 'All',
  merge: 'Merge',
  new: 'New',
  people: 'People',
  quick: 'Quick draft',
  'real-estate-transfer': 'Real estate transfer',
  'style-sets': 'Style sets',
  sync: 'Sync',
}

/**
 * Collection segments that have an index page of their own, so an intermediate
 * crumb for one can be a link. `chat` under `/admin/assistant` deliberately is
 * not here: only `/admin/assistant/chat/[chatId]` exists.
 */
const NAVIGABLE_SEGMENTS = new Set(['invoices'])

/** A path segment that identifies a record rather than naming a page. */
function isRecordId(segment: string): boolean {
  // UUIDs, and the bare numeric and long opaque ids the app also routes on.
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^\d+$/.test(segment) ||
    (segment.length >= 16 && !segment.includes('-'))
  )
}

function humanize(segment: string): string {
  const spaced = segment.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface BreadcrumbOptions {
  /**
   * The resolved name of the record this route is about, when the shell knows
   * it — the client on a matter page. Null while it loads or when there is
   * nothing to resolve, and the section's generic noun stands in.
   */
  recordLabel?: string | null
}

export function adminBreadcrumbs(pathname: string, options: BreadcrumbOptions = {}): Crumb[] {
  if (!pathname.startsWith('/admin')) return []

  const section = SECTIONS.find(
    candidate => pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`),
  )
  if (!section) return []

  // A section whose index is not at its prefix — Matters lives at
  // `/admin/matters` but its list is `/admin/matters/list`. Standing on that
  // list is standing on the Matters page, not one below it.
  if (pathname === section.href) return []

  const rest = pathname
    .slice(section.prefix.length)
    .split('/')
    .filter(Boolean)
    // Route groups like `(overview)` are a file-system concern and never appear
    // in a real pathname, but a test or a stray link can still carry one.
    .filter(segment => !segment.startsWith('('))

  const trail: Crumb[] = [{ label: section.label, href: section.href }]

  for (const segment of rest) {
    if (isRecordId(segment)) {
      trail.push({ label: options.recordLabel?.trim() || section.record })
    } else {
      trail.push({ label: SEGMENT_LABELS[segment] ?? humanize(segment) })
    }
  }

  // A single crumb repeats what the sidebar and the page title already say.
  if (trail.length < 2) return []

  return trail.map((crumb, index) => {
    // The last crumb is where you are, so it never links.
    if (index === trail.length - 1) return { label: crumb.label }
    if (index === 0) return crumb

    // `trail[i]` describes `rest[i - 1]`, so the path up to and including this
    // crumb is the section prefix plus the first `index` segments.
    const segment = rest[index - 1]
    const href = `${section.prefix}/${rest.slice(0, index).join('/')}`

    // Only link where a page is known to exist. A record id always has one —
    // something deeper is routing off it — but a collection segment may be a
    // path component with no index of its own, as `/admin/assistant/chat` is.
    // Guessing there ships a 404 into the chrome of every page below it.
    const navigable = isRecordId(segment) || NAVIGABLE_SEGMENTS.has(segment)
    return navigable ? { label: crumb.label, href } : { label: crumb.label }
  })
}
