import { describe, expect, it } from 'vitest'
import { groupTasksByRecord, type TaskRow } from '@/lib/tasks/types'
import { taskFixture as task } from './fixtures/task'

describe('groupTasksByRecord', () => {
  it('groups by record and orders sections alphabetically', () => {
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-2', record_name: 'Whitfield, Margaret' }),
      task({ id: 'b', matter_id: 'm-1', record_name: 'Alvarez, Ruth' }),
      task({ id: 'c', matter_id: 'm-2', record_name: 'Whitfield, Margaret' }),
    ])

    expect(groups.map(group => group.label)).toEqual(['Alvarez, Ruth', 'Whitfield, Margaret'])
    expect(groups[1].tasks.map(t => t.id)).toEqual(['a', 'c'])
  })

  it('keeps the order matters arrive in when asked, for server-ordered pages', () => {
    // The paged Tasks page receives matters most-urgent-first; an A–Z re-sort
    // would restart the alphabet on every page.
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-2', record_name: 'Whitfield, Margaret' }),
      task({ id: 'loose' }),
      task({ id: 'b', matter_id: 'm-1', record_name: 'Alvarez, Ruth' }),
    ], { keepOrder: true })

    expect(groups.map(group => group.label)).toEqual(['Whitfield, Margaret', 'Alvarez, Ruth', 'No related matter'])
  })

  it('puts unlinked tasks last under their own label', () => {
    const groups = groupTasksByRecord([
      task({ id: 'loose' }),
      task({ id: 'linked', matter_id: 'm-1', record_name: 'Alvarez, Ruth' }),
    ])

    expect(groups.map(group => group.label)).toEqual(['Alvarez, Ruth', 'No related matter'])
    expect(groups[1].tasks.map(t => t.id)).toEqual(['loose'])
  })

  it('keeps two records that share a display name in separate sections', () => {
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-1', record_name: 'John Smith' }),
      task({ id: 'b', lead_id: 'l-9', record_name: 'John Smith' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.key).sort()).toEqual(['l-9', 'm-1'])
  })

  it('labels a linked record with no name rather than merging it into the unlinked group', () => {
    const groups = groupTasksByRecord([
      task({ id: 'a', matter_id: 'm-1', record_name: null }),
      task({ id: 'b' }),
    ])

    expect(groups.map(group => group.label)).toEqual(['Unnamed record', 'No related matter'])
  })

  it('sorts tasks inside a section by effective due date', () => {
    const [group] = groupTasksByRecord([
      task({ id: 'later', matter_id: 'm-1', record_name: 'Alvarez, Ruth', due_at: '2026-08-10T12:00:00.000Z' }),
      task({ id: 'sooner', matter_id: 'm-1', record_name: 'Alvarez, Ruth', due_at: '2026-08-04T12:00:00.000Z' }),
    ])

    expect(group.tasks.map(t => t.id)).toEqual(['sooner', 'later'])
  })
})
