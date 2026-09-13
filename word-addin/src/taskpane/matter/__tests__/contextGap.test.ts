import { describe, expect, it } from 'vitest'
import { describeContextGap } from '../contextGap'

/**
 * The warning exists for one failure: the attorney links a matter, the brief
 * fails to build server-side, and the reply comes back fluent and sourceless.
 * Nothing else about that reply looks different, so this is the only signal.
 */
describe('describeContextGap', () => {
  it('says nothing when the design sheet reached the model', () => {
    expect(
      describeContextGap('m-1', { state: 'applied', matterNumber: 'EP-1', clientName: 'Ellis' }),
    ).toBeNull()
  })

  it('says nothing when no matter is linked', () => {
    // Document-only drafting is a deliberate mode, not a degraded one.
    expect(describeContextGap(null, { state: 'none' })).toBeNull()
    expect(describeContextGap(null, { state: 'unavailable', reason: 'whatever' })).toBeNull()
  })

  it('warns, with the reason, when a linked matter yielded no sheet', () => {
    const warning = describeContextGap('m-1', {
      state: 'unavailable',
      reason: 'Drafting is available only for hired matters: m-1',
    })
    expect(warning).toContain('WITHOUT')
    expect(warning).toContain('only for hired matters')
  })

  it('warns when a matter is linked but the server reported no context at all', () => {
    // 'none' from a server that never saw the matterId — an older deployment,
    // or a dropped field. The pane must not read that as success.
    expect(describeContextGap('m-1', { state: 'none' })).toContain('WITHOUT')
  })
})
