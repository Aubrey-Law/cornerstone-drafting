/**
 * `client_intake.planning_objectives` is a text column with two historical
 * writers: the client portal stores a keyed object
 * (`{ why_choose_firm, why_now, make_things_easy }`, serialized to JSON on the
 * way into the column) and the admin sheet stores free text. Readers must
 * accept both. The canonical in-memory shape is the object; admin free text
 * lives under its `notes` key.
 */

export type PlanningObjectives = Record<string, string>

/** Admin-sheet free text is stored under this key of the object shape. */
export const PLANNING_OBJECTIVES_NOTES_KEY = 'notes'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringEntries(record: Record<string, unknown>): PlanningObjectives {
  const out: PlanningObjectives = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.trim()) out[key] = value
  }
  return out
}

/**
 * Normalize a stored `planning_objectives` value to the object shape.
 * Accepts the object itself, its JSON serialization, or legacy admin free
 * text (returned as `{ notes: text }`). Returns null when there is nothing.
 */
export function parsePlanningObjectives(raw: unknown): PlanningObjectives | null {
  if (isPlainRecord(raw)) {
    const entries = stringEntries(raw)
    return Object.keys(entries).length > 0 ? entries : null
  }
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (isPlainRecord(parsed)) {
        const entries = stringEntries(parsed)
        return Object.keys(entries).length > 0 ? entries : null
      }
    } catch {
      /* fall through to free text */
    }
  }
  return { [PLANNING_OBJECTIVES_NOTES_KEY]: text }
}
