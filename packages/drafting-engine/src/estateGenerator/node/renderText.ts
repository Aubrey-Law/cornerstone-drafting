import nunjucks from 'nunjucks'

type RenderContext = Record<string, unknown>

interface RenderNodeEstateTextOptions {
  autoescape?: boolean
}

// Matches the loud holes left in a rendered document for empty values. Callers
// scan rendered output with this to report which fields are still unfilled.
export const MISSING_MARKER_RE = /\[\[\s*MISSING:\s*([^\]]+?)\s*\]\]/g

// Wrap simple `{{ path }}` / `{{ path | name }}` output placeholders so an empty
// value renders a visible `[[ MISSING: path ]]` marker instead of a blank — and
// never trips Nunjucks into throwing. Only a bare dotted path optionally piped
// through no-argument filters is matched; function calls (`include_clause(...)`),
// arithmetic, and other expressions are left untouched.
const SIMPLE_PLACEHOLDER_RE =
  /{{\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*(?:\[\])?)\s*((?:\|\s*[A-Za-z_][\w]*\s*)*)}}/g

// Placeholder paths a draft may legitimately leave blank. These render as
// nothing (no `[[ MISSING ]]` hole) when empty, keeping any surrounding label —
// e.g. "My Commission Expires:" — intact. The notary commission expiration is
// supplied by the notary's own seal/stamp at signing, so an unfilled value
// should not leave a blank fill line or a missing-field marker. This applies to
// both the docx body and injected clauses (the self-proving affidavit).
const OPTIONAL_PLACEHOLDER_PATHS = new Set(['execution.display_notary_commission'])

function missingMarker(label: string): string {
  return `[[ MISSING: ${label} ]]`
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  return false
}

function annotateMissing(source: string): string {
  return source.replace(SIMPLE_PLACEHOLDER_RE, (whole, path: string, filters: string) => {
    // `optional` placeholders are intentionally allowed to be empty (they render
    // nothing rather than a `[[ MISSING ]]` hole), so don't re-wrap them.
    if (filters.includes('orMissing') || filters.includes('optional')) return whole
    const chain = filters.trim() ? ` ${filters.trim()} ` : ' '
    const guard = OPTIONAL_PLACEHOLDER_PATHS.has(path) ? 'optional' : `orMissing("${path}")`
    return `{{ ${path}${chain}| ${guard} }}`
  })
}

function createEnvironment({ autoescape = false }: RenderNodeEstateTextOptions = {}): nunjucks.Environment {
  // throwOnUndefined stays off: missing values surface as `[[ MISSING: … ]]`
  // markers via the orMissing filter so a draft always renders with its holes
  // visible, rather than crashing on the first empty placeholder.
  const env = new nunjucks.Environment(undefined, { autoescape })
  const nameFilter = (value: unknown) => value == null ? '' : String(value).toUpperCase()
  env.addFilter('name', nameFilter)
  // Older firm templates used an uppercase NAME filter. Keep that narrow alias
  // so an otherwise valid uploaded master can be reviewed and migrated in place.
  env.addFilter('NAME', nameFilter)
  env.addFilter('orMissing', (value, label) => isEmptyValue(value) ? missingMarker(String(label)) : value)
  // `optional` renders an empty value as nothing (no MISSING marker) — for fields
  // a draft may legitimately leave blank, e.g. a notary commission supplied by
  // the notary's own seal at signing.
  env.addFilter('optional', value => isEmptyValue(value) ? '' : value)
  return env
}

export function renderNodeEstateText(
  source: string,
  context: RenderContext,
  globals: RenderContext = {},
  options: RenderNodeEstateTextOptions = {},
): string {
  const env = createEnvironment(options)
  for (const [key, value] of Object.entries(globals)) {
    env.addGlobal(key, value)
  }
  const client = context.client
  const legacyClient = client && typeof client === 'object'
    ? { ...(client as Record<string, unknown>), FULL_NAME: (client as Record<string, unknown>).full_name }
    : client
  return env.renderString(annotateMissing(source), {
    ...context,
    // Compatibility for the legacy `{{ CLIENT.FULL_NAME | NAME }}` footer.
    CLIENT: context.CLIENT ?? legacyClient,
  })
}
