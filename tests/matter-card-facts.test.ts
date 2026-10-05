import { describe, expect, it } from 'vitest'
import {
  formatLastMilestone,
  matterDaysSince,
  matterDeadlineTone,
  matterCustomName,
  matterIntakeBadge,
  matterMetaFacts,
  matterQuietDays,
  matterRecencyTone,
  matterSubtitle,
  matterTitle,
} from '@/lib/matters/cardFacts'
import type { MatterListRow } from '@/lib/queries/matters'

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0)
const DAY = 86_400_000

/**
 * `PipelineMatter` declares `client_name`, `matter_name` and `matter_created` as
 * non-nullable, but they come from a Postgres view that can return null for any of
 * them — which is why the helpers under test carry fallbacks at all. The override
 * type is deliberately loose so those runtime cases stay testable.
 */
function matter(overrides: Record<string, unknown> = {}): MatterListRow {
  return {
    matter_id: 'm1',
    matter_name: 'Smith Estate Plan',
    client_name: 'Jane Smith',
    matter_number: 'EP-1042',
    practice_area: 'estate_planning',
    intake_status: null,
    matter_created: new Date(NOW - 30 * DAY).toISOString(),
    documents_executed_at: null,
    drafts_sent_at: null,
    intake_submitted_at: null,
    unreviewed_intake_upload_count: 0,
    unreviewed_portal_upload_count: 0,
    ...overrides,
  } as unknown as MatterListRow
}

describe('matter card facts', () => {
  describe('identity', () => {
    it('prefers the client name, falling back to the matter name then a placeholder', () => {
      expect(matterTitle(matter())).toBe('Jane Smith')
      expect(matterTitle(matter({ client_name: null }))).toBe('Smith Estate Plan')
      expect(matterTitle(matter({ client_name: null, matter_name: null }))).toBe('Untitled')
    })

    it('joins the matter number and practice area, dropping a missing number', () => {
      expect(matterSubtitle(matter())).toContain('EP-1042')
      expect(matterSubtitle(matter({ matter_number: null })).startsWith(' · ')).toBe(false)
    })

    it('leads with a renamed matter\'s own name', () => {
      expect(matterSubtitle(matter())).toBe('Smith Estate Plan · EP-1042 · Estate Planning')
    })
  })

  describe('custom name', () => {
    it('treats the default "Client — Practice area" name as no name', () => {
      expect(matterCustomName(matter({ matter_name: 'Jane Smith — Estate Planning' }))).toBeNull()
      expect(matterCustomName(matter({ matter_name: 'jane smith - estate planning' }))).toBeNull()
      expect(matterCustomName(matter({ matter_name: 'Jane Smith' }))).toBeNull()
      expect(matterCustomName(matter({ matter_name: '  ' }))).toBeNull()
    })

    it('keeps a name that says more than the client does', () => {
      expect(matterCustomName(matter({ matter_name: 'Smith Family Trust' }))).toBe('Smith Family Trust')
    })

    it('stays out of the way when the title already falls back to the matter name', () => {
      expect(matterCustomName(matter({ client_name: null }))).toBeNull()
    })
  })

  describe('intake badge', () => {
    it('reads submitted as success, any other value as warning, and nothing as muted', () => {
      expect(matterIntakeBadge(matter({ intake_status: 'submitted' }))).toEqual({
        label: 'submitted',
        tone: 'success',
      })
      expect(matterIntakeBadge(matter({ intake_status: 'in_progress' }))).toEqual({
        label: 'in progress',
        tone: 'warning',
      })
      expect(matterIntakeBadge(matter({ intake_status: null }))).toEqual({ label: '—', tone: 'muted' })
    })
  })

  describe('recency', () => {
    it('never reports a negative age, so a clock skew cannot read as the future', () => {
      expect(matterDaysSince(NOW + 5 * DAY, NOW)).toBe(0)
    })

    it('takes the newest milestone across the four timestamps', () => {
      const m = matter({
        matter_created: new Date(NOW - 30 * DAY).toISOString(),
        intake_submitted_at: new Date(NOW - 3 * DAY).toISOString(),
        drafts_sent_at: null,
      })
      expect(matterQuietDays(m, NOW)).toBe(3)
    })

    it('returns null when no milestone has been reached', () => {
      const m = matter({ matter_created: null })
      expect(matterQuietDays(m, NOW)).toBeNull()
      expect(formatLastMilestone(null, NOW)).toBe('—')
    })

    it('names today and yesterday before falling back to a day count', () => {
      expect(formatLastMilestone(NOW, NOW)).toBe('Today')
      expect(formatLastMilestone(NOW - DAY, NOW)).toBe('Yesterday')
      expect(formatLastMilestone(NOW - 9 * DAY, NOW)).toBe('9d ago')
    })

    it('fades with age at the one-day and one-week boundaries', () => {
      expect(matterRecencyTone(NOW, NOW)).toBe('text-foreground')
      expect(matterRecencyTone(NOW - DAY, NOW)).toBe('text-muted-foreground')
      expect(matterRecencyTone(NOW - 6 * DAY, NOW)).toBe('text-muted-foreground')
      expect(matterRecencyTone(NOW - 7 * DAY, NOW)).toBe('text-muted-foreground/60')
      expect(matterRecencyTone(null, NOW)).toBe('text-muted-foreground/60')
    })
  })

  describe('deadline tone', () => {
    it('reserves red for genuinely overdue and amber for the next two days', () => {
      expect(matterDeadlineTone(NOW - DAY, NOW)).toBe('text-red font-medium')
      expect(matterDeadlineTone(NOW + DAY, NOW)).toBe('text-amber font-medium')
      expect(matterDeadlineTone(NOW + 3 * DAY, NOW)).toBe('text-foreground')
      expect(matterDeadlineTone(NOW + 30 * DAY, NOW)).toBe('text-muted-foreground')
      expect(matterDeadlineTone(null, NOW)).toBe('text-muted-foreground')
    })
  })

  describe('meta facts', () => {
    it('reports only recency when nothing is waiting to be read', () => {
      expect(matterMetaFacts(matter(), NOW)).toEqual(['30d ago'])
    })

    it('appends unreviewed uploads, which are a call to action rather than a status', () => {
      const facts = matterMetaFacts(
        matter({ unreviewed_intake_upload_count: 2, unreviewed_portal_upload_count: 1 }),
        NOW,
      )
      expect(facts).toHaveLength(2)
      expect(facts[1]).toMatch(/3/)
    })
  })
})
