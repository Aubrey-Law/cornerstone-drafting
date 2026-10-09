import { z } from 'zod'
import { parsePlanningObjectives } from '@/lib/intakePlanningObjectives'

const objectivesSchema = z.object({
  why_choose_firm: z.string().max(20000),
  why_now: z.string().max(20000),
  make_things_easy: z.string().max(20000),
}).strict()

/** Only these three questionnaire answers can be changed by this editor. */
export function planningObjectivesEditValue(raw: unknown) {
  const data = parsePlanningObjectives(raw) ?? {}
  return {
    why_choose_firm: data.why_choose_firm ?? '',
    why_now: data.why_now ?? '',
    make_things_easy: data.make_things_easy ?? '',
  }
}

export function mergeStaffPlanningObjectives(value: unknown, stored: unknown): string {
  const parsed = objectivesSchema.safeParse(value)
  if (!parsed.success) throw new Error('Enter text for each planning question, using no more than 20,000 characters per answer.')
  let previous: Record<string, unknown> = {}
  if (stored != null) {
    if (typeof stored === 'string') {
      // Preserve every key from serialized objects, including non-string metadata.
      // Other historical strings are free-text staff notes.
      let decoded: unknown
      try { decoded = JSON.parse(stored) } catch { /* Legacy free text. */ }
      previous = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
        ? decoded as Record<string, unknown> : stored ? { notes: stored } : {}
    } else if (typeof stored === 'object' && !Array.isArray(stored)) previous = stored as Record<string, unknown>
    else throw new Error('The saved planning answers need review before editing.')
  }
  for (const key of ['why_choose_firm', 'why_now', 'make_things_easy']) {
    if (previous[key] != null && typeof previous[key] !== 'string') throw new Error('The saved planning answers need review before editing.')
  }
  return JSON.stringify({ ...previous, ...parsed.data })
}
