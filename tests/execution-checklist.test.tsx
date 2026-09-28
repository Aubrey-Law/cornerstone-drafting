// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

// jsdom has no layout, so no ResizeObserver; the Radix checkbox measures itself with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
import { ExecutionChecklist } from '@/app/admin/matters/[id]/tabs/signing/ExecutionChecklist'

afterEach(cleanup)

const ceremony = () => within(screen.getByTestId('ceremony'))

describe('ExecutionChecklist', () => {
  it('starts from what was detected, and says that is a reading of file names', () => {
    render(<ExecutionChecklist detected={['will', 'trust']} unmatched={[]} />)
    expect(screen.getByLabelText('Will')).toBeChecked()
    expect(screen.getByLabelText('Deed')).not.toBeChecked()
    expect(screen.getByText(/not a fact/i)).toBeInTheDocument()
  })

  it('names the documents it could not place rather than dropping them', () => {
    render(<ExecutionChecklist detected={['will']} unmatched={['Smith_Estate Plan Summary.docx']} />)
    expect(screen.getByText(/Smith_Estate Plan Summary\.docx/)).toBeInTheDocument()
  })

  it('asks for the most witnesses any one document needs, not the sum', () => {
    render(<ExecutionChecklist detected={['will', 'health_care_proxy', 'trust']} unmatched={[]} />)
    expect(ceremony().getByText('2')).toBeInTheDocument()
  })

  /**
   * The statutory disqualification has to reach the person running the
   * appointment, not sit in a data structure. Appointing someone and having
   * them witness it is the error this screen exists to stop.
   */
  it('warns that the health care agent may not witness', () => {
    render(<ExecutionChecklist detected={['health_care_proxy']} unmatched={[]} />)
    expect(ceremony().getByText(/agent/i)).toBeInTheDocument()
  })

  it('lists what has to be recorded after everyone leaves', () => {
    render(<ExecutionChecklist detected={['deed']} unmatched={[]} />)
    expect(ceremony().getByText(/registry of deeds/i)).toBeInTheDocument()
  })

  it('recalculates when the attorney corrects what is being signed', () => {
    render(<ExecutionChecklist detected={['hipaa_authorization']} unmatched={[]} />)
    expect(ceremony().getByText('Not needed')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Deed'))
    expect(ceremony().getByText('Must attend')).toBeInTheDocument()
  })

  it('cites the authority for each document so it can be checked', () => {
    render(<ExecutionChecklist detected={['will']} unmatched={[]} />)
    expect(within(screen.getByTestId('requirement-will')).getByText(/190B, § 2-502/)).toBeInTheDocument()
  })

  it('says a will needs no notary to be valid, where the confusion lives', () => {
    render(<ExecutionChecklist detected={['will']} unmatched={[]} />)
    expect(
      within(screen.getByTestId('requirement-will')).getByText(/not required for the will to be valid/i),
    ).toBeInTheDocument()
  })

  it('asks what is being signed when nothing is selected', () => {
    render(<ExecutionChecklist detected={[]} unmatched={[]} />)
    expect(screen.getByText(/choose what is being signed/i)).toBeInTheDocument()
  })
})
