'use client'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { ChevronDown, Pencil, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import type { MatterDetailsRow } from '@/types/matter-details'
import { cn, formatDate } from '@/lib/utils'
import { PRACTICE_AREA_OPTIONS, normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { getFirmConfig } from '@/lib/firmConfig'
import { MATTER_PLAN_TYPE_OPTIONS, normalizePlanType } from '@/lib/matterPlanType'
import type { PipelineMatter } from '@/types/database'

export type DetailSection = 'matter' | 'estate' | 'probate' | 'legal' | 'notes' | 'timeline'

const TAX_OPTIONS = ['None', 'Moderate ($1M-$3M)', 'Significant ($3M-$7M)', 'Complex ($7M+)', 'Unknown']
const LEGAL_PLANS = ['MetLife', 'ARAG', 'LegalEase', 'Other']
const TRUST_TYPES = ['Revocable Trust', 'Irrevocable Trust', 'Special Needs Trust', 'Testamentary Trust', 'Other']
const CREDIT_SHELTER_OPTIONS = ['Not Applicable', 'Disclaimer', 'Clayton Election']
const TRUST_FUNDING_OPTIONS = ['Not Applicable', 'Not Started', 'In Progress', 'Complete']
const SIGNING_METHOD_OPTIONS = [
  { value: 'in_person', label: 'In person' },
  { value: 'remote_online_notary', label: 'Remote online notary' },
  { value: 'mail_away', label: 'Mail-away' },
]
const PROBATE_TYPE_OPTIONS = [
  { value: 'informal', label: 'Informal' },
  { value: 'formal', label: 'Formal' },
  { value: 'voluntary', label: 'Voluntary' },
  { value: 'small_estate', label: 'Small estate' },
  { value: 'ancillary', label: 'Ancillary' },
  { value: 'mupc_supervised', label: 'MUPC supervised' },
  { value: 'mupc_unsupervised', label: 'MUPC unsupervised' },
]

const DETAIL_SECTIONS: Array<{ key: DetailSection; label: string }> = [
  { key: 'matter', label: 'Matter Information' },
  { key: 'estate', label: 'Estate Planning' },
  { key: 'probate', label: 'Probate' },
]

const CORE_TIMELINE_DATES: Array<{ field: keyof MatterDetailsRow; label: string }> = [
  { field: 'open_date', label: 'Opened' },
  { field: 'hired_date', label: 'Hired' },
  { field: 'design_meeting_date', label: 'Design meeting' },
  { field: 'draft_sent_date', label: 'Drafts sent' },
  { field: 'drafts_approved_date', label: 'Drafts approved' },
  { field: 'client_review_date', label: 'Client review completed' },
  { field: 'revisions_sent_date', label: 'Revisions received' },
  { field: 'scheduled_signing_date', label: 'Target signing date' },
  { field: 'signing_date', label: 'Signing date' },
  { field: 'execution_date', label: 'Execution date' },
]

function fieldId(field: string) {
  return `matter-detail-field-${field}`
}

function DetailField({ label, span2 = false, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('space-y-1.5', span2 && 'sm:col-span-2')}>
      <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      {children}
    </label>
  )
}

function DetailSectionPanel({
  title,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center border-b border-border bg-surface-1 px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-gray-mid transition-transform duration-200', !open && '-rotate-90')} />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </button>
        {actions && (
          <div className="ml-2 flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {open && <div className="p-5 md:p-6">{children}</div>}
    </div>
  )
}

function hasDisplayValue(value: unknown) {
  return value !== null && value !== undefined && value !== ''
}

function ReadOnlyDetailField({
  label,
  value,
  span2 = false,
  showEmpty,
  field,
}: {
  label: string
  value: React.ReactNode
  span2?: boolean
  showEmpty: boolean
  field: string
}) {
  const empty = !hasDisplayValue(value) && typeof value !== 'boolean'
  if (empty && !showEmpty) return null

  return (
    <div data-matter-field={field} tabIndex={-1} className={cn('rounded-xl border border-border bg-surface-1 px-4 py-3 outline-none focus:ring-1 focus:ring-accent', span2 && 'sm:col-span-2')}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <div className={cn('mt-1.5 min-h-6 text-[15px] font-medium leading-6 text-foreground', empty && 'font-normal text-muted-foreground')}>
        {empty ? '—' : value}
      </div>
    </div>
  )
}

function SelectInput({
  value,
  options,
  placeholder = 'Select...',
  onChange,
  inputRef,
}: {
  value: string
  options: Array<string | { value: string; label: string }>
  placeholder?: string
  onChange: (value: string | null) => void
  inputRef?: (node: HTMLSelectElement | null) => void
}) {
  return (
    <select
      ref={inputRef}
      value={value}
      onChange={event => onChange(event.target.value || null)}
      className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-text-secondary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
    >
      <option value="">{placeholder}</option>
      {options.map(option => {
        const value = typeof option === 'string' ? option : option.value
        const label = typeof option === 'string' ? option : option.label
        return <option key={value} value={value}>{label}</option>
      })}
    </select>
  )
}

function CurrencyInput({
  value,
  onSave,
  inputRef,
}: {
  value: number | null | undefined
  onSave: (value: number | null) => void
  inputRef?: (node: HTMLInputElement | null) => void
}) {
  const [raw, setRaw] = useState(value != null ? String(value) : '')

  return (
    <Input
      ref={inputRef}
      value={raw}
      placeholder="$0"
      onChange={event => setRaw(event.target.value.replace(/[^0-9.]/g, ''))}
      onBlur={() => {
        const parsed = Number.parseFloat(raw)
        onSave(Number.isFinite(parsed) ? parsed : null)
      }}
      className="h-9"
    />
  )
}

function UnifiedMatterDetailsEditor({
  liveDetails,
  matter,
  matterId,
  matterNumber,
  onUpdateClientStatus,
  onFieldSaved,
  editRequest,
  onEditRequestHandled,
}: {
  liveDetails: MatterDetailsRow | null
  matter: PipelineMatter
  matterId: string
  matterNumber: string | null
  onUpdateClientStatus: (value: string) => Promise<void>
  onFieldSaved: (field: string, value: unknown, row?: MatterDetailsRow | null) => void
  editRequest: { section: DetailSection; field: string; nonce: number } | null
  onEditRequestHandled: () => void
}) {
  const practiceArea = normalizePracticeArea(liveDetails?.practice_area ?? matter.practice_area)
  const isEP = practiceArea === 'EP' || practiceArea === 'EP-LP'
  const isLP = practiceArea === 'EP-LP'
  const isProbate = practiceArea === 'Probate'
  const [generatingNumber, setGeneratingNumber] = useState(false)
  const [matterInfoEditing, setMatterInfoEditing] = useState(false)
  const [matterInfoShowEmpty, setMatterInfoShowEmpty] = useState(false)
  const [estateEditing, setEstateEditing] = useState(false)
  const [estateShowEmpty, setEstateShowEmpty] = useState(false)
  const [probateEditing, setProbateEditing] = useState(false)
  const [probateShowEmpty, setProbateShowEmpty] = useState(false)
  const [expanded, setExpanded] = useState<Record<DetailSection, boolean>>({
    matter: true,
    estate: isEP,
    probate: isProbate,
    legal: false,
    notes: false,
    timeline: true,
  })
  const visibleSections = DETAIL_SECTIONS.filter(section => {
    if (section.key === 'estate') return isEP
    if (section.key === 'probate') return isProbate
    return true
  })

  useEffect(() => {
    if (!editRequest) return
    const { section, field } = editRequest
    setExpanded(prev => (prev[section] ? prev : { ...prev, [section]: true }))
    if (section === 'matter' || section === 'notes') setMatterInfoEditing(true)
    if (section === 'estate' || section === 'legal') setEstateEditing(true)
    if (section === 'probate') setProbateEditing(true)
    let attempts = 0
    let cancelled = false
    const tryFocus = () => {
      if (cancelled) return
      const nodes = document.querySelectorAll<HTMLElement>(`[data-matter-field="${field}"]`)
      // Prefer a focusable input/select/textarea over the read-only display div.
      const target = Array.from(nodes).find(n => n.matches('input, select, textarea')) ?? nodes[0]
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.focus()
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          target.select?.()
        }
        onEditRequestHandled()
        return
      }
      if (attempts++ < 10) window.setTimeout(tryFocus, 30)
      else onEditRequestHandled()
    }
    const raf = window.requestAnimationFrame(tryFocus)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
    }
  }, [editRequest, onEditRequestHandled])

  const saveField = async (field: string, value: unknown) => {
    const normalizedValue = value === '' ? null : value
    try {
      if (field === 'client_status' && typeof normalizedValue === 'string') {
        await onUpdateClientStatus(normalizedValue)
        onFieldSaved(field, normalizedValue)
      } else {
        const response = await fetch('/api/admin/matter-details', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matterId, field, value: normalizedValue }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? `Failed to save ${field}`)
        onFieldSaved(field, normalizedValue, data.row ?? null)
      }
      toast.success('Saved', { duration: 1200 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
    }
  }

  const refFor = (field: string) => (node: HTMLElement | null) => {
    if (node) node.dataset.matterField = field
  }

  const text = (field: keyof MatterDetailsRow, fallback = '') => String((liveDetails?.[field] ?? fallback) as string)
  const bool = (field: keyof MatterDetailsRow) => Boolean(liveDetails?.[field])
  const boolText = (field: keyof MatterDetailsRow) => liveDetails?.[field] == null ? null : liveDetails[field] ? 'Yes' : 'No'
  const money = (value: number | null | undefined) => value != null && value > 0
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
    : null
  const matterInfoFields = [
    { field: 'matter_number', label: 'Matter Number', value: liveDetails?.matter_number ?? matterNumber },
    { field: 'client_status', label: 'Client Status', value: liveDetails?.client_status ?? matter.status },
    { field: 'matter_status', label: 'Matter Status', value: liveDetails?.matter_status },
    { field: 'practice_area', label: 'Practice Area', value: practiceAreaLabel(liveDetails?.practice_area ?? matter.practice_area) },
    { field: 'responsible_attorney', label: 'Responsible Attorney', value: liveDetails?.responsible_attorney },
    { field: 'paralegal_assigned', label: 'Paralegal', value: liveDetails?.paralegal_assigned },
    { field: 'referral_source', label: 'Referral Source', value: liveDetails?.referral_source ?? matter.referral_source },
    { field: 'billing_type', label: 'Billing Type', value: liveDetails?.billing_type },
    { field: 'flat_fee_amount', label: 'Fee', value: money(liveDetails?.flat_fee_amount ?? matter.fee_amount ?? null) },
    { field: 'iolta_required', label: 'IOLTA Required', value: boolText('iolta_required') },
    { field: 'fee_collected', label: 'Fee Collected', value: boolText('fee_collected') },
    { field: 'fee_collected_date', label: 'Fee Collected Date', value: liveDetails?.fee_collected_date ? formatDate(liveDetails.fee_collected_date) : null },
    ...(isLP ? [
      { field: 'legal_plan', label: 'Legal Plan', value: liveDetails?.legal_plan },
      { field: 'legal_plan_id', label: 'Legal Plan ID', value: liveDetails?.legal_plan_id },
    ] : []),
    { field: 'internal_notes', label: 'Internal Notes', value: liveDetails?.internal_notes, span2: true },
  ]
  const estateFields = [
    { field: 'plan_type', label: 'Plan Type', value: liveDetails?.plan_type ?? matter.plan_type },
    { field: 'ep_plan_category', label: 'Plan Category', value: liveDetails?.ep_plan_category },
    { field: 'trust_type', label: 'Trust Type', value: liveDetails?.trust_type },
    { field: 'est_estate_value', label: 'Estimated Estate Value', value: money(liveDetails?.est_estate_value ?? matter.estimated_value ?? null) },
    { field: 'tax_exposure', label: 'Tax Exposure', value: liveDetails?.tax_exposure },
    { field: 'credit_shelter_provisions', label: 'Credit Shelter Provisions', value: liveDetails?.credit_shelter_provisions },
    { field: 'trust_funding_status', label: 'Trust Funding Status', value: liveDetails?.trust_funding_status ?? liveDetails?.ep_funding_status },
    { field: 'ep_signing_method', label: 'Signing Method', value: liveDetails?.ep_signing_method },
    { field: 'ep_ma_estate_tax_savings', label: 'Projected MA Tax Savings', value: money(liveDetails?.ep_ma_estate_tax_savings ?? null) },
    { field: 'deed_recorded', label: 'Deed Recorded', value: boolText('deed_recorded') },
    { field: 'ep_separate_trusts', label: 'Separate Trusts', value: boolText('ep_separate_trusts') },
    { field: 'ep_has_ilit', label: 'ILIT in Plan', value: boolText('ep_has_ilit') },
    { field: 'ep_ma_estate_taxable', label: 'MA Estate Taxable', value: boolText('ep_ma_estate_taxable') },
    { field: 'ep_deed_transfers_needed', label: 'Deed Transfers Needed', value: boolText('ep_deed_transfers_needed') },
    { field: 'ep_beneficiary_updates_needed', label: 'Beneficiary Updates Needed', value: boolText('ep_beneficiary_updates_needed') },
    { field: 'ep_special_provisions', label: 'Special Provisions', value: liveDetails?.ep_special_provisions, span2: true },
  ]
  const probateFields = [
    { field: 'pb_decedent_name', label: 'Decedent Name', value: liveDetails?.pb_decedent_name },
    { field: 'pb_date_of_death', label: 'Date of Death', value: liveDetails?.pb_date_of_death ? formatDate(liveDetails.pb_date_of_death) : null },
    { field: 'pb_probate_type', label: 'Probate Type', value: liveDetails?.pb_probate_type },
    { field: 'pb_testate_intestate', label: 'Testate / Intestate', value: liveDetails?.pb_testate_intestate },
    { field: 'pb_court_name', label: 'Court Name', value: liveDetails?.pb_court_name },
    { field: 'pb_docket_number', label: 'Docket Number', value: liveDetails?.pb_docket_number },
    { field: 'pb_personal_representative', label: 'Personal Representative', value: liveDetails?.pb_personal_representative },
    { field: 'pb_surviving_spouse_name', label: 'Surviving Spouse Name', value: liveDetails?.pb_surviving_spouse_name },
    { field: 'pb_ancillary_probate_state', label: 'Ancillary Probate State', value: liveDetails?.pb_ancillary_probate_state },
    { field: 'pb_surviving_spouse', label: 'Surviving Spouse', value: boolText('pb_surviving_spouse') },
    { field: 'pb_elective_share_claimed', label: 'Elective Share Claimed', value: boolText('pb_elective_share_claimed') },
    { field: 'pb_has_minor_beneficiaries', label: 'Minor Beneficiaries', value: boolText('pb_has_minor_beneficiaries') },
    { field: 'pb_qualifies_small_estate', label: 'Qualifies Small Estate', value: boolText('pb_qualifies_small_estate') },
    { field: 'pb_ancillary_probate_required', label: 'Ancillary Probate Required', value: boolText('pb_ancillary_probate_required') },
    { field: 'pb_bond_waived_in_will', label: 'Bond Waived in Will', value: boolText('pb_bond_waived_in_will') },
    { field: 'pb_federal_estate_tax_required', label: 'Federal Estate Tax Required', value: boolText('pb_federal_estate_tax_required') },
    { field: 'pb_state_estate_tax_required', label: 'State Estate Tax Required', value: boolText('pb_state_estate_tax_required') },
    { field: 'pb_estate_closed', label: 'Estate Closed', value: boolText('pb_estate_closed') },
  ]

  const autoGenerateMatterNumber = async () => {
    setGeneratingNumber(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/matter-number`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to generate matter number')
      const num = body.matterNumber as string
      // The input is uncontrolled — reflect the generated value so the field
      // shows it and any later blur saves the same value, not a stale one.
      const input = document.getElementById(fieldId('matter_number')) as HTMLInputElement | null
      if (input) input.value = num
      await saveField('matter_number', num)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate matter number')
    } finally {
      setGeneratingNumber(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {visibleSections.map(section => (
            <Button
              key={section.key}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setExpanded(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
            >
              {section.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-accent"
          onClick={() => {
            const allOpen = visibleSections.some(section => !expanded[section.key])
            setExpanded(Object.fromEntries(DETAIL_SECTIONS.map(section => [section.key, allOpen])) as Record<DetailSection, boolean>)
          }}
        >
          {visibleSections.some(section => !expanded[section.key]) ? 'Expand all' : 'Collapse all'}
        </Button>
      </div>

      <DetailSectionPanel
        title="Matter Information"
        open={expanded.matter}
        onToggle={() => setExpanded(prev => ({ ...prev, matter: !prev.matter }))}
        actions={
          <>
            {!matterInfoEditing && (
              <button
                type="button"
                onClick={() => setMatterInfoShowEmpty(value => !value)}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-text-tertiary hover:bg-surface-1 hover:text-text-secondary"
              >
                {matterInfoShowEmpty ? 'Hide empty' : 'Show all'}
              </button>
            )}
            <Button
              type="button"
              variant={matterInfoEditing ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setMatterInfoEditing(value => !value)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              {matterInfoEditing ? 'Done' : 'Edit'}
            </Button>
          </>
        }
      >
        {!matterInfoEditing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {matterInfoFields.map(item => (
              <ReadOnlyDetailField
                key={item.field}
                field={item.field}
                label={item.label}
                value={item.value}
                span2={item.span2}
                showEmpty={matterInfoShowEmpty}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Matter Number" span2>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={fieldId('matter_number')}
                  ref={refFor('matter_number')}
                  defaultValue={liveDetails?.matter_number ?? matterNumber ?? ''}
                  placeholder="e.g. 2026-EPLP-Smith"
                  onBlur={event => void saveField('matter_number', event.target.value)}
                  className="h-9 max-w-[220px] tabular-nums"
                />
                <Button type="button" variant="outline" size="sm" className="h-9 text-xs" disabled={generatingNumber} onMouseDown={event => event.preventDefault()} onClick={() => void autoGenerateMatterNumber()}>
                  <Zap className="mr-1 h-3.5 w-3.5" />
                  {generatingNumber
                    ? 'Generating...'
                    : (liveDetails?.matter_number ?? matterNumber)
                    ? 'Regenerate'
                    : 'Auto-generate'}
                </Button>
              </div>
            </DetailField>
            <DetailField label="Client Status">
              <SelectInput inputRef={refFor('client_status')} value={liveDetails?.client_status ?? matter.status ?? ''} options={['lead', 'hired', 'active', 'inactive', 'archived']} onChange={value => value && void saveField('client_status', value)} />
            </DetailField>
            <DetailField label="Matter Status">
              <SelectInput inputRef={refFor('matter_status')} value={liveDetails?.matter_status ?? ''} options={['active', 'pending', 'on_hold', 'closed']} onChange={value => void saveField('matter_status', value)} />
            </DetailField>
            <DetailField label="Practice Area">
              <SelectInput inputRef={refFor('practice_area')} value={liveDetails?.practice_area ?? matter.practice_area ?? ''} options={PRACTICE_AREA_OPTIONS} onChange={value => void saveField('practice_area', value)} />
            </DetailField>
            <DetailField label="Billing Type">
              <SelectInput inputRef={refFor('billing_type')} value={liveDetails?.billing_type ?? ''} options={['Flat Fee', 'Hourly', 'Contingency', 'No charge']} onChange={value => void saveField('billing_type', value)} />
            </DetailField>
            <DetailField label="Fee">
              <CurrencyInput inputRef={refFor('flat_fee_amount')} value={liveDetails?.flat_fee_amount ?? matter.fee_amount ?? null} onSave={value => void saveField('flat_fee_amount', value)} />
            </DetailField>
            <DetailField label="Responsible Attorney">
              <SelectInput inputRef={refFor('responsible_attorney')} value={liveDetails?.responsible_attorney ?? ''} options={[{ value: getFirmConfig().attorneyShortName, label: getFirmConfig().attorneyShortName }]} onChange={value => void saveField('responsible_attorney', value)} />
            </DetailField>
            <DetailField label="Paralegal">
              <Input ref={refFor('paralegal_assigned')} defaultValue={text('paralegal_assigned')} onBlur={event => void saveField('paralegal_assigned', event.target.value)} className="h-9" />
            </DetailField>
            <DetailField label="Referral Source" span2>
              <Input ref={refFor('referral_source')} defaultValue={text('referral_source', matter.referral_source ?? '')} onBlur={event => void saveField('referral_source', event.target.value)} className="h-9" />
            </DetailField>
            <label className="flex h-9 items-center gap-2 text-sm text-text-secondary">
              <input ref={refFor('iolta_required')} type="checkbox" checked={bool('iolta_required')} onChange={event => void saveField('iolta_required', event.target.checked)} />
              IOLTA required
            </label>
            <label className="flex h-9 items-center gap-2 text-sm text-text-secondary">
              <input ref={refFor('fee_collected')} type="checkbox" checked={bool('fee_collected')} onChange={event => void saveField('fee_collected', event.target.checked)} />
              Fee collected
            </label>
            <DetailField label="Fee Collected Date">
              <Input ref={refFor('fee_collected_date')} type="date" defaultValue={text('fee_collected_date')} onBlur={event => void saveField('fee_collected_date', event.target.value)} className="h-9" />
            </DetailField>
            {isLP && (
              <>
                <DetailField label="Legal Plan">
                  <SelectInput inputRef={refFor('legal_plan')} value={liveDetails?.legal_plan ?? ''} options={LEGAL_PLANS} onChange={value => void saveField('legal_plan', value)} />
                </DetailField>
                <DetailField label="Legal Plan ID">
                  <Input ref={refFor('legal_plan_id')} defaultValue={text('legal_plan_id')} onBlur={event => void saveField('legal_plan_id', event.target.value)} className="h-9" />
                </DetailField>
              </>
            )}
            <DetailField label="Internal Notes" span2>
              <Textarea ref={refFor('internal_notes')} defaultValue={text('internal_notes')} rows={5} onBlur={event => void saveField('internal_notes', event.target.value)} />
            </DetailField>
          </div>
        )}
      </DetailSectionPanel>

      {isEP && (
        <DetailSectionPanel
          title="Estate Planning"
          open={expanded.estate}
          onToggle={() => setExpanded(prev => ({ ...prev, estate: !prev.estate }))}
          actions={
            <>
              {!estateEditing && (
                <button type="button" onClick={() => setEstateShowEmpty(value => !value)} className="rounded-md px-2 py-1 text-[11px] font-medium text-text-tertiary hover:bg-surface-1 hover:text-text-secondary">
                  {estateShowEmpty ? 'Hide empty' : 'Show all'}
                </button>
              )}
              <Button type="button" variant={estateEditing ? 'default' : 'outline'} size="sm" className="h-7 text-[11px]" onClick={() => setEstateEditing(value => !value)}>
                <Pencil className="mr-1 h-3 w-3" />
                {estateEditing ? 'Done' : 'Edit'}
              </Button>
            </>
          }
        >
          {!estateEditing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {estateFields.map(item => (
                  <ReadOnlyDetailField key={item.field} field={item.field} label={item.label} value={item.value} span2={item.span2} showEmpty={estateShowEmpty} />
                ))}
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Plan Type">
                <SelectInput inputRef={refFor('plan_type')} value={normalizePlanType(liveDetails?.plan_type ?? matter.plan_type)} options={MATTER_PLAN_TYPE_OPTIONS} onChange={value => void saveField('plan_type', value)} />
              </DetailField>
              <DetailField label="Estimated Estate Value">
                <CurrencyInput inputRef={refFor('est_estate_value')} value={liveDetails?.est_estate_value ?? matter.estimated_value ?? null} onSave={value => void saveField('est_estate_value', value)} />
              </DetailField>
              <DetailField label="Tax Exposure">
                <SelectInput inputRef={refFor('tax_exposure')} value={liveDetails?.tax_exposure ?? ''} options={TAX_OPTIONS} onChange={value => void saveField('tax_exposure', value)} />
              </DetailField>
              <DetailField label="Plan Category">
                <SelectInput inputRef={refFor('ep_plan_category')} value={liveDetails?.ep_plan_category ?? ''} options={[
                  { value: 'initial', label: 'Initial' },
                  { value: 'amendment', label: 'Amendment' },
                  { value: 'restatement', label: 'Restatement' },
                  { value: 'review_update', label: 'Review / Update' },
                ]} onChange={value => void saveField('ep_plan_category', value)} />
              </DetailField>
              <DetailField label="Trust Type">
                <SelectInput inputRef={refFor('trust_type')} value={liveDetails?.trust_type ?? ''} options={TRUST_TYPES} onChange={value => void saveField('trust_type', value)} />
              </DetailField>
              <DetailField label="Credit Shelter Provisions">
                <SelectInput inputRef={refFor('credit_shelter_provisions')} value={liveDetails?.credit_shelter_provisions ?? ''} options={CREDIT_SHELTER_OPTIONS} onChange={value => void saveField('credit_shelter_provisions', value)} />
              </DetailField>
              <DetailField label="Trust Funding Status">
                <SelectInput inputRef={refFor('trust_funding_status')} value={liveDetails?.trust_funding_status ?? liveDetails?.ep_funding_status ?? ''} options={TRUST_FUNDING_OPTIONS} onChange={value => void saveField('trust_funding_status', value)} />
              </DetailField>
              <DetailField label="Signing Method">
                <SelectInput inputRef={refFor('ep_signing_method')} value={liveDetails?.ep_signing_method ?? ''} options={SIGNING_METHOD_OPTIONS} onChange={value => void saveField('ep_signing_method', value)} />
              </DetailField>
              <DetailField label="Projected MA Tax Savings">
                <CurrencyInput inputRef={refFor('ep_ma_estate_tax_savings')} value={liveDetails?.ep_ma_estate_tax_savings ?? null} onSave={value => void saveField('ep_ma_estate_tax_savings', value)} />
              </DetailField>
              {[
                ['deed_recorded', 'Deed Recorded'],
                ['ep_separate_trusts', 'Separate Trusts'],
                ['ep_has_ilit', 'ILIT in Plan'],
                ['ep_ma_estate_taxable', 'MA Estate Taxable'],
                ['ep_deed_transfers_needed', 'Deed Transfers Needed'],
                ['ep_beneficiary_updates_needed', 'Beneficiary Updates Needed'],
              ].map(([field, label]) => (
                <label key={field} className="flex h-9 items-center gap-2 text-sm text-text-secondary">
                  <input ref={refFor(field)} type="checkbox" checked={bool(field as keyof MatterDetailsRow)} onChange={event => void saveField(field, event.target.checked)} />
                  {label}
                </label>
              ))}
              <DetailField label="Special Provisions" span2>
                <Textarea ref={refFor('ep_special_provisions')} defaultValue={text('ep_special_provisions')} rows={4} onBlur={event => void saveField('ep_special_provisions', event.target.value)} />
              </DetailField>
            </div>
          )}
        </DetailSectionPanel>
      )}

      {isProbate && (
        <DetailSectionPanel
          title="Probate"
          open={expanded.probate}
          onToggle={() => setExpanded(prev => ({ ...prev, probate: !prev.probate }))}
          actions={
            <>
              {!probateEditing && (
                <button type="button" onClick={() => setProbateShowEmpty(value => !value)} className="rounded-md px-2 py-1 text-[11px] font-medium text-text-tertiary hover:bg-surface-1 hover:text-text-secondary">
                  {probateShowEmpty ? 'Hide empty' : 'Show all'}
                </button>
              )}
              <Button type="button" variant={probateEditing ? 'default' : 'outline'} size="sm" className="h-7 text-[11px]" onClick={() => setProbateEditing(value => !value)}>
                <Pencil className="mr-1 h-3 w-3" />
                {probateEditing ? 'Done' : 'Edit'}
              </Button>
            </>
          }
        >
          {!probateEditing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {probateFields.map(item => (
                <ReadOnlyDetailField key={item.field} field={item.field} label={item.label} value={item.value} showEmpty={probateShowEmpty} />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Decedent Name">
                <Input ref={refFor('pb_decedent_name')} defaultValue={text('pb_decedent_name')} onBlur={event => void saveField('pb_decedent_name', event.target.value)} className="h-9" />
              </DetailField>
              <DetailField label="Date of Death">
                <Input ref={refFor('pb_date_of_death')} type="date" defaultValue={text('pb_date_of_death')} onBlur={event => void saveField('pb_date_of_death', event.target.value)} className="h-9" />
              </DetailField>
              <DetailField label="Probate Type">
                <SelectInput inputRef={refFor('pb_probate_type')} value={liveDetails?.pb_probate_type ?? ''} options={PROBATE_TYPE_OPTIONS} onChange={value => void saveField('pb_probate_type', value)} />
              </DetailField>
              <DetailField label="Testate / Intestate">
                <SelectInput inputRef={refFor('pb_testate_intestate')} value={liveDetails?.pb_testate_intestate ?? ''} options={['testate', 'intestate']} onChange={value => void saveField('pb_testate_intestate', value)} />
              </DetailField>
              {[
                ['pb_court_name', 'Court Name'],
                ['pb_docket_number', 'Docket Number'],
                ['pb_personal_representative', 'Personal Representative'],
                ['pb_surviving_spouse_name', 'Surviving Spouse Name'],
                ['pb_ancillary_probate_state', 'Ancillary Probate State'],
              ].map(([field, label]) => (
                <DetailField key={field} label={label}>
                  <Input ref={refFor(field)} defaultValue={text(field as keyof MatterDetailsRow)} onBlur={event => void saveField(field, event.target.value)} className="h-9" />
                </DetailField>
              ))}
              {[
                ['pb_surviving_spouse', 'Surviving Spouse'],
                ['pb_elective_share_claimed', 'Elective Share Claimed'],
                ['pb_has_minor_beneficiaries', 'Minor Beneficiaries'],
                ['pb_qualifies_small_estate', 'Qualifies Small Estate'],
                ['pb_ancillary_probate_required', 'Ancillary Probate Required'],
                ['pb_bond_waived_in_will', 'Bond Waived in Will'],
                ['pb_federal_estate_tax_required', 'Federal Estate Tax Required'],
                ['pb_state_estate_tax_required', 'State Estate Tax Required'],
                ['pb_estate_closed', 'Estate Closed'],
              ].map(([field, label]) => (
                <label key={field} className="flex h-9 items-center gap-2 text-sm text-text-secondary">
                  <input ref={refFor(field)} type="checkbox" checked={bool(field as keyof MatterDetailsRow)} onChange={event => void saveField(field, event.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          )}
        </DetailSectionPanel>
      )}

    </div>
  )
}
function MatterTimelineCard({
  liveDetails,
  matter,
  matterId,
  onFieldSaved,
}: {
  liveDetails: MatterDetailsRow | null
  matter: PipelineMatter
  matterId: string
  onFieldSaved: (field: string, value: unknown, row?: MatterDetailsRow | null) => void
}) {
  const isClosed = (liveDetails?.matter_status ?? '').toLowerCase() === 'closed'
  const dates: Array<{ field: keyof MatterDetailsRow; label: string }> = [
    ...CORE_TIMELINE_DATES,
    { field: isClosed ? 'closed_date' : 'target_close_date', label: isClosed ? 'Matter closed' : 'Target close' } as { field: keyof MatterDetailsRow; label: string },
  ]
  const setCount = dates.filter(({ field }) => Boolean(liveDetails?.[field])).length
  const pct = dates.length > 0 ? Math.round((setCount / dates.length) * 100) : 100

  const save = async (field: string, value: string) => {
    try {
      const response = await fetch('/api/admin/matter-details', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId, field, value: value || null }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? `Failed to save ${field}`)
      onFieldSaved(field, value || null, data.row ?? null)
      toast.success('Saved', { duration: 1200 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
    }
  }

  void matter
  const [open, setOpen] = useState(false)

  return (
    <div id="matter-timeline" className="scroll-mt-24 rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between border-b border-border bg-surface-1 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={cn('h-3.5 w-3.5 text-gray-mid transition-transform duration-200', !open && '-rotate-90')} />
          <span className="text-[11.5px] font-semibold text-text-secondary">Matter Timeline</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10.5px] text-text-tertiary">{setCount}/{dates.length}</span>
          <span className="text-[10.5px] font-semibold text-accent">{pct}%</span>
        </span>
      </button>
      {open && (
        <>
          <div className="px-4 py-2">
            {dates.map(({ field, label }) => {
              const value = (liveDetails?.[field] as string | null | undefined) ?? ''
              const isSet = Boolean(value)
              return (
                <div key={String(field)} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-b-0">
                  <span className={cn('text-[11.5px] truncate', isSet ? 'font-medium text-text-secondary' : 'text-text-tertiary')}>
                    {label}
                  </span>
                  <Input
                    type="date"
                    value={value}
                    onChange={event => void save(String(field), event.target.value)}
                    className="h-7 w-[8.5rem] text-[11px]"
                  />
                </div>
              )
            })}
          </div>
          <div className="px-4 pb-3">
            <div className="h-1 overflow-hidden rounded-full bg-page-bg">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[10.5px] text-text-tertiary">{setCount} of {dates.length} dates set</p>
          </div>
        </>
      )}
    </div>
  )
}

export function MatterDetailsEditor({
  liveDetails,
  matter,
  matterId,
  matterNumber,
  onUpdateClientStatus,
  onFieldSaved,
}: {
  liveDetails: MatterDetailsRow | null
  matter: PipelineMatter
  matterId: string
  matterNumber: string | null
  onUpdateClientStatus: (value: string) => Promise<void>
  onFieldSaved: (field: string, value: unknown, row?: MatterDetailsRow | null) => void
}) {
  const [editRequest, setEditRequest] = useState<{ section: DetailSection; field: string; nonce: number } | null>(null)

  return (
    <div className="space-y-4">
      <UnifiedMatterDetailsEditor
        liveDetails={liveDetails}
        matter={matter}
        matterId={matterId}
        matterNumber={matterNumber}
        onUpdateClientStatus={onUpdateClientStatus}
        onFieldSaved={onFieldSaved}
        editRequest={editRequest}
        onEditRequestHandled={() => setEditRequest(null)}
      />
      <MatterTimelineCard
        liveDetails={liveDetails}
        matter={matter}
        matterId={matterId}
        onFieldSaved={onFieldSaved}
      />
    </div>
  )
}
