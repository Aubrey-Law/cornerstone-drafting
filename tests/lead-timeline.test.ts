import { describe, expect, it } from 'vitest'
import { buildLeadTimeline, filterLeadTimeline } from '@/lib/leads/timeline'

const notes = [
  {
    id: 'note-1',
    body: 'Discuss trust funding.',
    noteType: 'internal' as const,
    actorId: 'user-1',
    createdAt: '2026-07-25T15:00:00.000Z',
    updatedAt: '2026-07-25T15:00:00.000Z',
  },
]

const meetings = [
  {
    id: 'meeting-1',
    title: 'Planning meeting',
    date: '2026-07-24T13:00:00.000Z',
    attendees: ['Jane Client', 'Scott Attorney'],
    body: 'Reviewed the estate plan.',
    source: 'manual',
    granolaNoteId: null,
    actorId: 'user-2',
    createdAt: '2026-07-25T16:00:00.000Z',
    updatedAt: '2026-07-25T16:00:00.000Z',
  },
]

const activity = [
  {
    id: 'activity-1',
    event_type: 'status_changed',
    title: 'Lead status changed',
    detail: 'New → Contacted',
    actor_id: 'missing-user',
    created_at: '2026-07-25T17:00:00.000Z',
  },
]

describe('lead timeline normalization', () => {
  it('normalizes notes and meetings with actor names and meeting-date metadata', () => {
    const result = buildLeadTimeline({
      notes,
      meetings,
      activity: [],
      actorNames: { 'user-1': 'Alice Attorney', 'user-2': 'Ben Attorney' },
    })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'meeting:meeting-1',
        kind: 'meeting',
        title: 'Planning meeting',
        actorId: 'user-2',
        actorName: 'Ben Attorney',
        occurredAt: meetings[0].createdAt,
      }),
      {
        id: 'note:note-1',
        kind: 'note',
        title: 'Internal note',
        body: notes[0].body,
        actorId: 'user-1',
        actorName: 'Alice Attorney',
        occurredAt: notes[0].createdAt,
        editableNoteId: 'note-1',
      },
    ])
    expect(result[0].body).toContain('Meeting date: Jul 24, 2026')
    expect(result[0].body).toContain('Attendees: Jane Client, Scott Attorney')
  })

  it('sorts all sources newest first and labels unknown actors as System', () => {
    const result = buildLeadTimeline({
      notes,
      meetings,
      activity,
      actorNames: { 'user-1': 'Alice Attorney', 'user-2': 'Ben Attorney' },
    })

    expect(result.map(item => item.id)).toEqual([
      'system:activity-1',
      'meeting:meeting-1',
      'note:note-1',
    ])
    expect(result[0]).toMatchObject({
      kind: 'system',
      actorId: 'missing-user',
      actorName: 'System',
      body: 'New → Contacted',
    })
  })

  it('filters all, notes plus meetings, and system activity', () => {
    const items = buildLeadTimeline({
      notes,
      meetings,
      activity,
      actorNames: {},
    })

    expect(filterLeadTimeline(items, 'all')).toHaveLength(3)
    expect(filterLeadTimeline(items, 'notes').map(item => item.kind)).toEqual(['meeting', 'note'])
    expect(filterLeadTimeline(items, 'system').map(item => item.kind)).toEqual(['system'])
  })
})

describe('lead note types', () => {
  it('titles a note by what it is for', () => {
    const [internal, clientComm] = buildLeadTimeline({
      notes: [
        notes[0],
        { ...notes[0], id: 'note-2', noteType: 'client_comm' as const, createdAt: '2026-07-25T14:00:00.000Z' },
      ],
      meetings: [],
      activity: [],
      actorNames: {},
    })
    expect(internal.title).toBe('Internal note')
    expect(clientComm.title).toBe('Client communication')
  })
})

describe('lead timeline echo dedupe', () => {
  it('suppresses a recognized same-actor note echo within five seconds', () => {
    const result = buildLeadTimeline({
      notes,
      meetings: [],
      activity: [
        {
          id: 'note-echo',
          event_type: 'note_added',
          title: 'Note added',
          detail: notes[0].body,
          actor_id: 'user-1',
          created_at: '2026-07-25T15:00:05.000Z',
        },
      ],
      actorNames: {},
    })

    expect(result.map(item => item.id)).toEqual(['note:note-1'])
  })

  it('suppresses a recognized same-actor meeting echo within five seconds', () => {
    const result = buildLeadTimeline({
      notes: [],
      meetings,
      activity: [
        {
          id: 'meeting-echo',
          event_type: 'meeting_note_added',
          title: 'Granola meeting note imported',
          detail: meetings[0].title,
          actor_id: 'user-2',
          created_at: '2026-07-25T16:00:04.999Z',
        },
      ],
      actorNames: {},
    })

    expect(result.map(item => item.id)).toEqual(['meeting:meeting-1'])
  })

  it('retains unrelated activity and does not dedupe by title alone', () => {
    const result = buildLeadTimeline({
      notes,
      meetings: [],
      activity: [
        {
          id: 'different-actor',
          event_type: 'note_added',
          title: 'Note added',
          detail: notes[0].body,
          actor_id: 'user-2',
          created_at: '2026-07-25T15:00:01.000Z',
        },
        {
          id: 'outside-window',
          event_type: 'note_added',
          title: 'Note added',
          detail: notes[0].body,
          actor_id: 'user-1',
          created_at: '2026-07-25T15:00:05.001Z',
        },
        {
          id: 'same-title-only',
          event_type: 'status_changed',
          title: 'Note added',
          detail: null,
          actor_id: 'user-1',
          created_at: '2026-07-25T15:00:01.000Z',
        },
      ],
      actorNames: {},
    })

    expect(result.map(item => item.id)).toEqual([
      'system:outside-window',
      'system:different-actor',
      'system:same-title-only',
      'note:note-1',
    ])
  })
})
