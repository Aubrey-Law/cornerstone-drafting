// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/app/execution/[matterId]/ceremonyActions', () => ({
  recordCeremony: vi.fn(),
  recordCeremonyDocument: vi.fn(),
}))

import { CeremonyRecord } from '@/app/execution/[matterId]/CeremonyRecord'
import type { Ceremony } from '@/lib/ceremony/repository'

afterEach(cleanup)

const ceremony = (over: Partial<Ceremony> = {}): Ceremony => ({
  id: 'c-1',
  matterId: 'm-1',
  scheduledFor: null,
  location: null,
  notaryName: 'Alex Cho',
  witnessOneName: 'Dana Reed',
  witnessTwoName: 'Sam Patel',
  healthCareAgentName: null,
  status: 'scheduled',
  completedAt: null,
  note: null,
  documents: [],
  ...over,
})

const executedWill = (over = {}) => ({
  documentKind: 'will' as const,
  executed: true,
  signedOn: '2026-09-01',
  witnessCount: 2,
  notarized: true,
  recordedOn: null,
  recordingReference: null,
  note: null,
  ...over,
})

describe('CeremonyRecord', () => {
  it('asks to start a record before offering to tick documents off', () => {
    render(<CeremonyRecord matterId="m-1" ceremony={null} kinds={['will']} />)
    expect(screen.getByRole('button', { name: /start the record/i })).toBeInTheDocument()
    expect(screen.queryByTestId('ceremony-will')).not.toBeInTheDocument()
  })

  it('lists each document once the record exists', () => {
    render(<CeremonyRecord matterId="m-1" ceremony={ceremony()} kinds={['will', 'trust']} />)
    expect(screen.getByTestId('ceremony-will')).toBeInTheDocument()
    expect(screen.getByTestId('ceremony-trust')).toBeInTheDocument()
  })

  /**
   * The check that justifies the whole feature: a will recorded with one
   * witness is not a will, and it must be said now, while the people are still
   * reachable.
   */
  it('says a will witnessed by one person may not be valid', () => {
    render(
      <CeremonyRecord
        matterId="m-1"
        ceremony={ceremony({ documents: [executedWill({ witnessCount: 1 })] })}
        kinds={['will']}
      />,
    )
    const problems = within(screen.getByTestId('problems'))
    expect(problems.getByText(/may not be valid/i)).toBeInTheDocument()
    expect(problems.getByText(/two witnesses/i)).toBeInTheDocument()
  })

  it('separates something outstanding from something invalid', () => {
    render(
      <CeremonyRecord
        matterId="m-1"
        ceremony={ceremony({
          documents: [
            { documentKind: 'deed', executed: true, signedOn: '2026-09-01', witnessCount: 0, notarized: true, recordedOn: null, recordingReference: null, note: null },
          ],
        })}
        kinds={['deed']}
      />,
    )
    // An unrecorded deed is good between the parties; it is not yet finished.
    expect(within(screen.getByTestId('problems')).getByText(/still outstanding/i)).toBeInTheDocument()
  })

  it('asks who the health care agent is only when a proxy is being signed', () => {
    const { rerender } = render(
      <CeremonyRecord matterId="m-1" ceremony={ceremony()} kinds={['will']} />,
    )
    expect(screen.queryByLabelText(/health care agent/i)).not.toBeInTheDocument()

    rerender(<CeremonyRecord matterId="m-1" ceremony={ceremony()} kinds={['health_care_proxy']} />)
    expect(screen.getByLabelText(/health care agent/i)).toBeInTheDocument()
    expect(screen.getByText(/agent may not witness it/i)).toBeInTheDocument()
  })

  /**
   * Typed live rather than on save: the attorney finds out while the witness is
   * still in the room, which is the only time it can be fixed.
   */
  it('objects as soon as the agent is named as a witness', () => {
    render(
      <CeremonyRecord
        matterId="m-1"
        ceremony={ceremony({
          documents: [
            { documentKind: 'health_care_proxy', executed: true, signedOn: '2026-09-01', witnessCount: 2, notarized: false, recordedOn: null, recordingReference: null, note: null },
          ],
        })}
        kinds={['health_care_proxy']}
      />,
    )
    expect(screen.queryByText(/agent may not witness the proxy/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/health care agent/i), { target: { value: 'Dana Reed' } })
    expect(within(screen.getByTestId('problems')).getByText(/agent may not witness the proxy/i)).toBeInTheDocument()
  })

  it('asks for the recording details only for a document that gets recorded', () => {
    render(
      <CeremonyRecord
        matterId="m-1"
        ceremony={ceremony({ documents: [executedWill(), { documentKind: 'deed', executed: true, signedOn: '2026-09-01', witnessCount: 0, notarized: true, recordedOn: null, recordingReference: null, note: null }] })}
        kinds={['will', 'deed']}
      />,
    )
    expect(within(screen.getByTestId('ceremony-deed')).getByLabelText(/book and page/i)).toBeInTheDocument()
    expect(within(screen.getByTestId('ceremony-will')).queryByLabelText(/book and page/i)).not.toBeInTheDocument()
  })

  it('says nothing is wrong with a properly executed set', () => {
    render(
      <CeremonyRecord matterId="m-1" ceremony={ceremony({ documents: [executedWill()] })} kinds={['will']} />,
    )
    expect(screen.queryByTestId('problems')).not.toBeInTheDocument()
  })
})
