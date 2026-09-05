// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { recordAssetFunding } = vi.hoisted(() => ({ recordAssetFunding: vi.fn() }))
vi.mock('@/app/funding/[matterId]/actions', () => ({ recordAssetFunding }))

import { AssetRow } from '@/app/funding/[matterId]/AssetRow'
import type { FundingAsset } from '@/lib/funding/rollup'

afterEach(cleanup)

const asset = (over: Partial<FundingAsset> = {}): FundingAsset => ({
  assetId: 'a-1',
  category: 'bank',
  description: 'Everyday checking',
  ownership: 'client',
  value: 25_000,
  method: 'retitle',
  status: 'not_started',
  confirmedOn: null,
  note: null,
  isRecorded: false,
  ...over,
})

const openEditor = () => fireEvent.click(screen.getByRole('button', { name: /update|change/i }))
const methodOptions = () =>
  [...(screen.getByLabelText(/how it joins the plan/i) as HTMLSelectElement).options].map((o) => o.value)

describe('AssetRow', () => {
  it('shows what the asset is, what it is worth, and where it stands', () => {
    render(<AssetRow matterId="m-1" asset={asset()} />)
    expect(screen.getByText('Everyday checking')).toBeInTheDocument()
    expect(screen.getByText('$25,000')).toBeInTheDocument()
    expect(screen.getByText('Not started')).toBeInTheDocument()
  })

  /**
   * A suggested method is marked as a suggestion. The attorney should never
   * mistake "this is what this category usually needs" for "someone decided
   * this".
   */
  it('marks an unrecorded method as merely suggested', () => {
    render(<AssetRow matterId="m-1" asset={asset()} />)
    expect(screen.getByText(/suggested/i)).toBeInTheDocument()
  })

  it('does not call a recorded method a suggestion', () => {
    render(<AssetRow matterId="m-1" asset={asset({ isRecorded: true, status: 'in_progress' })} />)
    expect(screen.queryByText(/suggested/i)).not.toBeInTheDocument()
  })

  /**
   * The rule, reaching the interface.
   *
   * Retitling an IRA into a revocable trust is a taxable distribution of the
   * whole account. The form must not be able to express it — a warning after
   * the fact is too late, because by then the paperwork has been filed.
   */
  it('offers a retirement account no way to be retitled or deeded', () => {
    render(<AssetRow matterId="m-1" asset={asset({ category: 'retirement', method: 'beneficiary' })} />)
    openEditor()
    expect(methodOptions()).not.toContain('retitle')
    expect(methodOptions()).not.toContain('deed')
    expect(methodOptions()).toContain('beneficiary')
  })

  it('offers a deed for real estate', () => {
    render(<AssetRow matterId="m-1" asset={asset({ category: 'real_estate', method: 'deed' })} />)
    openEditor()
    expect(methodOptions()).toContain('deed')
  })

  /**
   * Confirmed is the only status that asserts anything about the outside world,
   * so it is the only one that asks for a date — and it asks for the date the
   * institution confirmed, not the date the form went out.
   */
  it('asks for a date only once the status claims confirmation', () => {
    render(<AssetRow matterId="m-1" asset={asset()} />)
    openEditor()
    expect(screen.queryByLabelText(/confirmation received/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: 'confirmed' } })
    const date = screen.getByLabelText(/confirmation received/i)
    expect(date).toBeRequired()
    expect(screen.getByText(/not the date the form was sent/i)).toBeInTheDocument()
  })

  it('shows the confirmation date on a funded asset without opening the form', () => {
    render(<AssetRow matterId="m-1" asset={asset({ status: 'confirmed', confirmedOn: '2026-08-12', isRecorded: true })} />)
    expect(screen.getByText(/Confirmed · Aug 12, 2026/)).toBeInTheDocument()
  })

  it('carries the asset and matter through the form so the action knows what to save', () => {
    const { container } = render(<AssetRow matterId="m-1" asset={asset({ category: 'retirement' })} />)
    openEditor()
    const hidden = Object.fromEntries(
      [...container.querySelectorAll('input[type=hidden]')].map((i) => [
        (i as HTMLInputElement).name,
        (i as HTMLInputElement).value,
      ]),
    )
    expect(hidden).toMatchObject({ matterId: 'm-1', assetId: 'a-1', category: 'retirement' })
  })

  it('shows a dash rather than NaN for an asset with no value', () => {
    render(<AssetRow matterId="m-1" asset={asset({ value: null })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
