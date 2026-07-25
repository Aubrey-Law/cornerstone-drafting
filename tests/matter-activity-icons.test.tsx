// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MatterActivityTab } from '@/app/admin/matters/[id]/MatterActivityTab'
import type { ActivityEventType, MatterActivity } from '@/types/database'

function activity(
  id: string,
  eventType: ActivityEventType,
  actorName: string | null = 'Jane Doe',
): MatterActivity {
  return {
    id,
    matter_id: 'matter-1',
    event_type: eventType,
    actor_id: actorName ? 'actor-1' : null,
    actor_email: null,
    actor_name: actorName,
    title: `${eventType} event`,
    detail: null,
    metadata: null,
    created_at: '2026-07-25T14:00:00.000Z',
  }
}

afterEach(cleanup)

describe('matter activity event icons', () => {
  it('renders event icons instead of actor initials and keeps actor metadata', () => {
    render(
      <MatterActivityTab
        loading={false}
        activity={[
          activity('stage', 'stage_changed'),
          activity('complete', 'intake_completed'),
          activity('draft', 'draft_generated'),
          activity('fallback', 'note_added'),
        ]}
      />,
    )

    expect(screen.getByLabelText('Stage changed activity').querySelector('svg')?.classList.contains('lucide-activity')).toBe(true)
    expect(screen.getByLabelText('Intake completed activity').querySelector('svg')?.classList.contains('lucide-circle-check')).toBe(true)
    expect(screen.getByLabelText('Draft generated activity').querySelector('svg')?.classList.contains('lucide-file-text')).toBe(true)
    expect(screen.getByLabelText('Matter activity').querySelector('svg')?.classList.contains('lucide-info')).toBe(true)
    expect(screen.queryByText('JD')).toBeNull()
    expect(screen.getAllByText(/Jane Doe/)).toHaveLength(4)
  })
})
