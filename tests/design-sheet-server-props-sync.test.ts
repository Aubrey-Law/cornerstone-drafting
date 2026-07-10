import { describe, expect, it } from 'vitest'
import { shouldApplyServerSheetProps } from '@/lib/designSheet/shouldApplyServerSheetProps'

describe('shouldApplyServerSheetProps', () => {
  it('ignores unchanged props stamps', () => {
    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:00:00.000Z',
      propsSheetStamp: '2026-07-10T20:00:00.000Z',
      serverSheetStamp: '2026-07-10T20:00:00.000Z',
      saveStatus: 'saved',
    })).toEqual({ action: 'ignore' })
  })

  it('ignores props while local edits are dirty or saving', () => {
    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:01:00.000Z',
      propsSheetStamp: '2026-07-10T20:00:00.000Z',
      serverSheetStamp: '2026-07-10T20:00:00.000Z',
      saveStatus: 'dirty',
    })).toEqual({ action: 'ignore' })

    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:01:00.000Z',
      propsSheetStamp: '2026-07-10T20:00:00.000Z',
      serverSheetStamp: '2026-07-10T20:00:00.000Z',
      saveStatus: 'saving',
    })).toEqual({ action: 'ignore' })
  })

  it('ignores stale props older than the last local save', () => {
    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:00:00.000Z',
      propsSheetStamp: '2026-07-10T19:59:00.000Z',
      serverSheetStamp: '2026-07-10T20:01:00.000Z',
      saveStatus: 'saved',
    })).toEqual({ action: 'ignore' })
  })

  it('acknowledges same-timestamp props after a local save without rebuilding', () => {
    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:01:00.000Z',
      propsSheetStamp: '2026-07-10T20:00:00.000Z',
      serverSheetStamp: '2026-07-10T20:01:00.000Z',
      saveStatus: 'saved',
    })).toEqual({ action: 'acknowledge' })
  })

  it('acknowledges all props after local edits even when newer', () => {
    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:02:00.000Z',
      propsSheetStamp: '2026-07-10T20:00:00.000Z',
      serverSheetStamp: '2026-07-10T20:01:00.000Z',
      saveStatus: 'saved',
      hasLocalEdits: true,
    })).toEqual({ action: 'acknowledge' })
  })

  it('applies props that are newer than the last local save', () => {
    expect(shouldApplyServerSheetProps({
      stamp: '2026-07-10T20:02:00.000Z',
      propsSheetStamp: '2026-07-10T20:00:00.000Z',
      serverSheetStamp: '2026-07-10T20:01:00.000Z',
      saveStatus: 'saved',
    })).toEqual({ action: 'apply' })
  })
})
