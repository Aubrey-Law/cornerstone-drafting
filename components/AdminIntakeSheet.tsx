'use client'

import React, { useId, useState, useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { getAdminIntakeData, saveAdminIntakeDraft, submitAdminIntake, resolveMatterIntake } from '@/app/actions/adminIntake'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'
import type { AdminIntakeFormData, AdminIntakeChild } from '@/types/adminIntake'
import { AddressAutocomplete, type ParsedAddress } from '@/components/address-autocomplete'
import ContactCombobox, { type ContactSuggestion } from '@/components/intake/ContactCombobox'
import { AdminIntakeUploadsList } from '@/components/admin/AdminIntakeUploadsList'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { formatPhoneInput } from '@/lib/phone'
import { DEFAULT_INTAKE_TRACK, getIntakeTrack, type IntakeTrack } from '@/lib/intakeTrack'
import {
  MA_COUNTY_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  ESTATE_VALUE_OPTIONS,
  PRONOUN_OPTIONS,
} from '@/lib/sharedFields'
import {
  adminFiduciaryFlatFromRoles,
  probateFlatFromDetails,
  type AdminFiduciaryRoleRow,
} from '@/lib/adminIntakeFiduciaries'

// ── Props ────────────────────────────────────────────────────────────────────

interface AdminIntakeSheetProps {
  leadId: string | null
  matterId?: string | null
  clientIntakeId: string | null
  clientUserId: string | null
  practiceArea: string
  clientName: string
  open: boolean
  onClose: () => void
  onSubmitted: () => void
  onIntakeIdChange?: (intakeId: string) => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isEP = (pa: string) => pa.toLowerCase().includes('estate planning') || pa === ''
const isProbate = (pa: string) => pa.toLowerCase().includes('probate')

function uid() {
  return Math.random().toString(36).slice(2)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 mb-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
      {children}
    </div>
  )
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div className="mb-1 text-xs font-medium text-muted-foreground">
      {children}{required && <span className="ml-0.5 text-destructive">*</span>}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <div className="mt-1 text-[11px] text-destructive">{message}</div>
}

// Compact variants of the shared Input/Textarea density for this dense sheet.
const inputCls = 'h-[34px] px-2.5 text-[13px] md:text-[13px]'
const textareaCls = 'min-h-20 px-2.5 py-2 text-[13px] md:text-[13px]'

// Native <select> (platform picker) styled with the Input primitive's tokens.
const selectCls =
  'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-[34px] w-full cursor-pointer rounded-md border bg-transparent px-2.5 text-[13px] shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]'

function SegmentedYesNo({
  value, onChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  const buttonCls = (active: boolean) => cn(
    'rounded-[5px] px-3.5 py-1 text-xs font-medium transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
  )
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
      <button type="button" aria-pressed={value} className={buttonCls(value)} onClick={() => onChange(true)}>Yes</button>
      <button type="button" aria-pressed={!value} className={buttonCls(!value)} onClick={() => onChange(false)}>No</button>
    </div>
  )
}

/** Pronoun picker. Documents are generated with these, so every person the
 *  sheet captures — client, spouse, children, fiduciaries — gets one. */
function PronounSelect({
  value, onChange, title,
}: {
  value: string
  onChange: (v: string) => void
  title?: string
}) {
  return (
    <select
      className={selectCls}
      value={value}
      onChange={e => onChange(e.target.value)}
      title={title}
      aria-label={title}
    >
      <option value="">Pronouns…</option>
      {PRONOUN_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Field-level wrapper with optional two-column grid ─────────────────────────

function Row2({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {children}
    </div>
  )
}

function Field({ children, span2 }: { children: React.ReactNode; span2?: boolean }) {
  return <div className={span2 ? 'col-span-2' : undefined}>{children}</div>
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminIntakeSheet({
  leadId,
  matterId = null,
  clientIntakeId,
  clientUserId,
  practiceArea,
  clientName,
  open,
  onClose,
  onSubmitted,
  onIntakeIdChange,
}: AdminIntakeSheetProps) {
  const [form, setForm] = useState<AdminIntakeFormData>(() =>
    emptyAdminIntakeFormData()
  )
  const [initialForm, setInitialForm] = useState<AdminIntakeFormData>(() =>
    emptyAdminIntakeFormData()
  )
  const [currentIntakeId, setCurrentIntakeId] = useState<string | null>(clientIntakeId)
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null)
  const [intakeTrack, setIntakeTrack] = useState<IntakeTrack>(DEFAULT_INTAKE_TRACK)
  const [intakeContacts, setIntakeContacts] = useState<ContactSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof AdminIntakeFormData, string>>>({})
  const [footerError, setFooterError] = useState('')
  const [showDiscard, setShowDiscard] = useState(false)
  const [manualAddress, setManualAddress] = useState(false)
  const [addressSearch, setAddressSearch] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const firstErrorRef = useRef<HTMLDivElement>(null)
  const checkboxId = useId()

  // The College Preparation Plan track never asks about assets, a spouse, or a
  // trust, so this attorney form must not present those fields as if it had.
  // Its own answers (school, HIPAA scope, living will) live in the guided
  // questionnaire — this sheet stays the shared client/fiduciary editor.
  const isCollegePrep = intakeTrack === 'college_prep'
  const showEP = isEP(practiceArea) && !isCollegePrep
  const showProbate = isProbate(practiceArea) && !isCollegePrep
  const showSpouse = form.marital_status === 'married'
  const showGuardian = form.has_minor_children
  const clientLocked = intakeStatus === 'submitted' || intakeStatus === 'approved'

  // ── Derive dirty state ──────────────────────────────────────────────────────
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  // ── Load initial data when sheet opens ────────────────────────────────────
  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function loadIntake(idToLoad: string) {
      setLoading(true)
      try {
        const raw = await getAdminIntakeData(idToLoad)
        if (cancelled || !raw) return
        const mapped = mapRawToForm(raw)
        setForm(mapped)
        setInitialForm(mapped)
        setCurrentIntakeId(idToLoad)
        onIntakeIdChange?.(idToLoad)
        setIntakeStatus(typeof raw.status === 'string' ? raw.status : null)
        setIntakeTrack(getIntakeTrack(raw))
        setIntakeContacts(
          Array.isArray(raw['_intake_contacts'])
            ? (raw['_intake_contacts'] as ContactSuggestion[])
            : [],
        )
      } catch (err) {
        if (!cancelled) {
          toast.error(`Failed to load intake: ${(err as Error).message}`)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    async function bootstrap() {
      let idToLoad = clientIntakeId

      if (!idToLoad && matterId) {
        setLoading(true)
        try {
          idToLoad = await resolveMatterIntake(matterId)
        } catch (err) {
          if (!cancelled) {
            toast.error(`Failed to resolve intake: ${(err as Error).message}`)
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      }

      if (cancelled) return

      if (idToLoad) {
        onIntakeIdChange?.(idToLoad)
        await loadIntake(idToLoad)
        return
      }

      if (clientName) {
        const parts = clientName.trim().split(' ')
        const first = parts[0] ?? ''
        const last = parts.slice(1).join(' ') ?? ''
        const pre = { ...emptyAdminIntakeFormData(), first_name: first, last_name: last }
        setForm(pre)
        setInitialForm(pre)
        setCurrentIntakeId(null)
        setIntakeStatus(null)
        return
      }

      const blank = emptyAdminIntakeFormData()
      setForm(blank)
      setInitialForm(blank)
      setCurrentIntakeId(null)
      setIntakeStatus(null)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [open, clientIntakeId, clientName, matterId, onIntakeIdChange])

  // Sync currentIntakeId if prop changes
  useEffect(() => {
    setCurrentIntakeId(clientIntakeId)
  }, [clientIntakeId])

  // ── Form helpers ──────────────────────────────────────────────────────────
  const set = useCallback(<K extends keyof AdminIntakeFormData>(key: K, value: AdminIntakeFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
  }, [])

  const str = (key: keyof AdminIntakeFormData) => (form[key] as string) ?? ''
  const bool = (key: keyof AdminIntakeFormData) => Boolean(form[key])

  // ── Close guard ──────────────────────────────────────────────────────────
  function requestClose() {
    if (isDirty) {
      setShowDiscard(true)
    } else {
      doClose()
    }
  }

  function doClose() {
    setShowDiscard(false)
    setErrors({})
    setFooterError('')
    const blank = emptyAdminIntakeFormData()
    setForm(blank)
    setInitialForm(blank)
    setCurrentIntakeId(null)
    setIntakeStatus(null)
    setIntakeTrack(DEFAULT_INTAKE_TRACK)
    onClose()
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): boolean {
    const e: Partial<Record<keyof AdminIntakeFormData, string>> = {}
    if (!form.first_name.trim()) e.first_name = 'Required'
    if (!form.last_name.trim()) e.last_name = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    // Marital status and assets are estate-track questions. The College
    // Preparation Plan hides both, so requiring them here would leave the
    // attorney with errors pointing at fields that are not on screen.
    if (!isCollegePrep) {
      if (!form.marital_status) e.marital_status = 'Required'
      const hasAsset = form.has_real_property || form.has_retirement || form.has_investments ||
        form.has_business || form.has_life_insurance || form.estate_value
      if (!hasAsset) e.estate_value = 'At least one asset field is required'
    }
    setErrors(e)
    if (Object.keys(e).length > 0) {
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
      return false
    }
    return true
  }

  // ── Save draft ─────────────────────────────────────────────────────────────
  async function handleSaveDraft() {
    setSaving(true)
    setFooterError('')
    try {
      const result = await saveAdminIntakeDraft({ leadId, matterId, clientIntakeId: currentIntakeId, clientUserId, data: form })
      setCurrentIntakeId(result.id)
      onIntakeIdChange?.(result.id)
      setInitialForm({ ...form })
      setIntakeStatus(prev => (prev === 'submitted' || prev === 'approved' ? prev : 'draft'))
      toast.success(clientLocked ? 'Attorney edits saved' : 'Draft saved')
    } catch (err) {
      setFooterError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Submit intake ──────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validate()) return
    setSubmitting(true)
    setFooterError('')
    try {
      const result = await submitAdminIntake({ leadId, matterId, clientIntakeId: currentIntakeId, clientUserId, data: form })
      setCurrentIntakeId(result.id)
      onIntakeIdChange?.(result.id)
      toast.success('Intake submitted')
      doClose()
      onSubmitted()
    } catch (err) {
      setFooterError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Children list helpers ──────────────────────────────────────────────────
  function addChild() {
    set('children', [
      ...form.children,
      { id: uid(), first_name: '', middle_name: '', last_name: '', date_of_birth: '', preferred_pronoun: '' },
    ])
  }

  function removeChild(id: string) {
    set('children', form.children.filter(c => c.id !== id))
  }

  function updateChild(id: string, field: keyof AdminIntakeChild, value: string) {
    set('children', form.children.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  // ── Special circumstances toggle ────────────────────────────────────────────
  function toggleCircumstance(val: string) {
    const current = form.special_circumstances
    set('special_circumstances',
      current.includes(val) ? current.filter(c => c !== val) : [...current, val]
    )
  }

  return (
    <Sheet open={open} onOpenChange={nextOpen => { if (!nextOpen) requestClose() }}>
      <SheetContent side="right" className="w-[520px] max-w-[100vw] gap-0 border-l bg-card p-0 sm:max-w-[520px]">
        {/* ── Header ── */}
        <SheetHeader className="shrink-0 gap-1 border-b border-border px-6 pt-5 pb-4">
          <SheetTitle className="text-[15px] leading-tight font-medium text-foreground">
            Intake — {clientName || 'Client'}
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs text-muted-foreground">
            Filling out on behalf of client
          </SheetDescription>
        </SheetHeader>

        {/* ── Body ── */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="py-12 text-center text-[13px] text-muted-foreground">
              Loading intake data…
            </div>
          ) : (
            <>
              {isCollegePrep && (
                <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">College Preparation Plan intake.</span>{' '}
                  The student is the client. School, HIPAA, and living-will answers are captured in
                  the guided questionnaire — this sheet edits the student&apos;s details and agents.
                </div>
              )}

              {/* ── Section: Client information ── */}
              <GroupLabel>Client Information</GroupLabel>

              {/* first/last error anchor */}
              {(errors.first_name || errors.last_name) && <div ref={firstErrorRef} />}

              <Row2>
                <Field>
                  <FieldLabel required>First Name</FieldLabel>
                  <Input
                    className={inputCls} aria-invalid={Boolean(errors.first_name)}
                    value={str('first_name')}
                    onChange={e => set('first_name', e.target.value)}
                  />
                  <FieldError message={errors.first_name} />
                </Field>
                <Field>
                  <FieldLabel>Middle Name</FieldLabel>
                  <Input className={inputCls} value={str('middle_name')} onChange={e => set('middle_name', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel required>Last Name</FieldLabel>
                  <Input
                    className={inputCls} aria-invalid={Boolean(errors.last_name)}
                    value={str('last_name')}
                    onChange={e => set('last_name', e.target.value)}
                  />
                  <FieldError message={errors.last_name} />
                </Field>
                <Field>
                  <FieldLabel>Suffix</FieldLabel>
                  <select className={selectCls} value={str('suffix')} onChange={e => set('suffix', e.target.value)}>
                    <option value="">—</option>
                    {['Jr.', 'Sr.', 'II', 'III', 'IV', 'Esq.'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field>
                  <FieldLabel>Date of Birth</FieldLabel>
                  <Input className={inputCls} type="date" value={str('date_of_birth')} onChange={e => set('date_of_birth', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>US Citizen</FieldLabel>
                  <div className="mt-1">
                    <SegmentedYesNo value={bool('is_us_citizen')} onChange={v => set('is_us_citizen', v)} />
                  </div>
                </Field>
                <Field>
                  <FieldLabel>Pronouns</FieldLabel>
                  <PronounSelect
                    value={str('preferred_pronoun')}
                    onChange={v => set('preferred_pronoun', v)}
                    title="Client pronouns"
                  />
                </Field>
                <Field>
                  <FieldLabel required>Email</FieldLabel>
                  <Input
                    className={inputCls} aria-invalid={Boolean(errors.email)}
                    type="email"
                    value={str('email')}
                    onChange={e => set('email', e.target.value)}
                  />
                  <FieldError message={errors.email} />
                </Field>
                <Field>
                  <FieldLabel>Phone</FieldLabel>
                  <Input
                    className={inputCls}
                    type="tel"
                    autoComplete="tel"
                    value={str('phone')}
                    onChange={e => set('phone', formatPhoneInput(e.target.value))}
                    placeholder="(555) 555-5555"
                  />
                </Field>
              </Row2>

              {/* Address */}
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <FieldLabel>Search Address</FieldLabel>
                  <button
                    type="button"
                    onClick={() => setManualAddress(v => !v)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {manualAddress ? 'Use search' : 'Enter manually'}
                  </button>
                </div>
                {!manualAddress && (
                  <AddressAutocomplete
                    value={addressSearch}
                    onChange={setAddressSearch}
                    onPlaceSelected={(parsed: ParsedAddress) => {
                      set('address_line1', parsed.address_line1)
                      set('city', parsed.city)
                      set('state', parsed.state || 'MA')
                      set('zip', parsed.zip)
                      if (parsed.county) set('county', parsed.county)
                    }}
                    className="mb-2"
                  />
                )}
                <FieldLabel>Street Address</FieldLabel>
                <Input
                  className={cn(inputCls, 'mb-2')}
                  name="address-line1"
                  autoComplete="address-line1"
                  value={str('address_line1')}
                  onChange={e => set('address_line1', e.target.value)}
                  placeholder="Street address"
                />
                <Input
                  className={inputCls}
                  name="address-line2"
                  autoComplete="address-line2"
                  value={str('address_line2')}
                  onChange={e => set('address_line2', e.target.value)}
                  placeholder="Apt, unit, etc. (optional)"
                />
              </div>
              <Row2 className="mt-2">
                <Field>
                  <FieldLabel>City</FieldLabel>
                  <Input className={inputCls} name="address-level2" autoComplete="address-level2" value={str('city')} onChange={e => set('city', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>State</FieldLabel>
                  <Input className={inputCls} name="address-level1" autoComplete="address-level1" value={str('state')} onChange={e => set('state', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>ZIP</FieldLabel>
                  <Input className={inputCls} name="postal-code" autoComplete="postal-code" value={str('zip')} onChange={e => set('zip', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>County</FieldLabel>
                  <select className={selectCls} value={str('county')} onChange={e => set('county', e.target.value)}>
                    <option value="">Select county</option>
                    {MA_COUNTY_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </Row2>

              {/* Marital status */}
              <div className="mt-3">
                {errors.marital_status && <div ref={firstErrorRef} />}
                <FieldLabel required>Marital Status</FieldLabel>
                <select
                  className={selectCls} aria-invalid={Boolean(errors.marital_status)}
                  value={str('marital_status')}
                  onChange={e => set('marital_status', e.target.value)}
                >
                  <option value="">Select…</option>
                  {MARITAL_STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <FieldError message={errors.marital_status} />
              </div>

              {/* ── Section: Spouse ── */}
              {showSpouse && !isCollegePrep && (
                <>
                  <GroupLabel>Spouse / Partner</GroupLabel>
                  <Row2>
                    <Field>
                      <FieldLabel>First Name</FieldLabel>
                      <Input className={inputCls} value={str('spouse_first_name')} onChange={e => set('spouse_first_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Middle Name</FieldLabel>
                      <Input className={inputCls} value={str('spouse_middle_name')} onChange={e => set('spouse_middle_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Last Name</FieldLabel>
                      <Input className={inputCls} value={str('spouse_last_name')} onChange={e => set('spouse_last_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of Birth</FieldLabel>
                      <Input className={inputCls} type="date" value={str('spouse_date_of_birth')} onChange={e => set('spouse_date_of_birth', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>US Citizen</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo
                          value={bool('spouse_is_us_citizen')}
                          onChange={v => set('spouse_is_us_citizen', v)}
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel>Pronouns</FieldLabel>
                      <PronounSelect
                        value={str('spouse_preferred_pronoun')}
                        onChange={v => set('spouse_preferred_pronoun', v)}
                        title="Spouse pronouns"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Date of Marriage</FieldLabel>
                      <Input className={inputCls} type="date" value={str('date_of_marriage')} onChange={e => set('date_of_marriage', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Email</FieldLabel>
                      <Input className={inputCls} type="email" value={str('spouse_email')} onChange={e => set('spouse_email', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Phone</FieldLabel>
                      <Input
                        className={inputCls}
                        type="tel"
                        value={str('spouse_phone')}
                        onChange={e => set('spouse_phone', formatPhoneInput(e.target.value))}
                        placeholder="(555) 555-5555"
                      />
                    </Field>
                  </Row2>
                </>
              )}

              {/* ── Section: Family (not asked on the College Prep track) ── */}
              {!isCollegePrep && (
                <>
                  <GroupLabel>Family</GroupLabel>
                  <Row2>
                    <Field>
                      <FieldLabel>Children?</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo value={bool('has_children')} onChange={v => { set('has_children', v); if (!v) { set('has_minor_children', false); set('children', []) } }} />
                      </div>
                    </Field>
                    {form.has_children && (
                      <Field>
                        <FieldLabel>Minor children (under 18)?</FieldLabel>
                        <div className="mt-1">
                          <SegmentedYesNo value={bool('has_minor_children')} onChange={v => set('has_minor_children', v)} />
                        </div>
                      </Field>
                    )}
                  </Row2>

                  {form.has_children && (
                    <div className="mt-3">
                      <FieldLabel>Children</FieldLabel>
                      {form.children.map((child, idx) => (
                        <div key={child.id} className="mb-2 flex items-center gap-2">
                          <Input
                            className={cn(inputCls, 'flex-1')}
                            placeholder="First name"
                            value={child.first_name}
                            onChange={e => updateChild(child.id, 'first_name', e.target.value)}
                          />
                          <Input
                            className={cn(inputCls, 'flex-1')}
                            placeholder="Middle name"
                            value={child.middle_name}
                            onChange={e => updateChild(child.id, 'middle_name', e.target.value)}
                          />
                          <Input
                            className={cn(inputCls, 'flex-1')}
                            placeholder="Last name"
                            value={child.last_name}
                            onChange={e => updateChild(child.id, 'last_name', e.target.value)}
                          />
                          <Input
                            className={cn(inputCls, 'w-[130px] flex-none')}
                            type="date"
                            value={child.date_of_birth}
                            onChange={e => updateChild(child.id, 'date_of_birth', e.target.value)}
                            title={`Child ${idx + 1} date of birth`}
                          />
                          <div className="w-[120px] flex-none">
                            <PronounSelect
                              value={child.preferred_pronoun ?? ''}
                              onChange={v => updateChild(child.id, 'preferred_pronoun', v)}
                              title={`Child ${idx + 1} pronouns`}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-muted-foreground"
                            aria-label={`Remove child ${idx + 1}`}
                            onClick={() => removeChild(child.id)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-1 px-0 text-xs text-primary hover:bg-transparent hover:text-primary"
                        onClick={addChild}
                      >
                        + Add child
                      </Button>
                    </div>
                  )}

                  <div className="mt-3">
                    <FieldLabel>Family notes</FieldLabel>
                    <Textarea
                      className={textareaCls}
                      value={str('family_notes')}
                      onChange={e => set('family_notes', e.target.value)}
                      placeholder="Notes about dependents, blended family, or other family complexity…"
                      rows={3}
                    />
                  </div>
                </>
              )}

              {/* ── Section: Assets (not asked on the College Prep track) ── */}
              {!isCollegePrep && (
                <>
                  <GroupLabel>Assets</GroupLabel>
                  <div className="mb-3">
                    {errors.estate_value && <div ref={firstErrorRef} />}
                    <FieldLabel>Approximate estate value</FieldLabel>
                    <select
                      className={selectCls} aria-invalid={Boolean(errors.estate_value)}
                      value={str('estate_value')}
                      onChange={e => set('estate_value', e.target.value)}
                    >
                      <option value="">Select range…</option>
                      {ESTATE_VALUE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <FieldError message={errors.estate_value} />
                  </div>

                  <Row2>
                    <Field>
                      <FieldLabel>Real property?</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo value={bool('has_real_property')} onChange={v => set('has_real_property', v)} />
                      </div>
                    </Field>
                    {form.has_real_property && (
                      <Field>
                        <FieldLabel>Approx. property value</FieldLabel>
                        <Input className={inputCls} value={str('real_property_value')} onChange={e => set('real_property_value', e.target.value)} placeholder="e.g. $650K" />
                      </Field>
                    )}
                  </Row2>
                  {form.has_real_property && (
                    <div className="mt-2">
                      <FieldLabel>Property address</FieldLabel>
                      <Input className={inputCls} value={str('real_property_address')} onChange={e => set('real_property_address', e.target.value)} />
                    </div>
                  )}

                  <Row2 className="mt-3">
                    <Field>
                      <FieldLabel>Retirement accounts?</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo value={bool('has_retirement')} onChange={v => set('has_retirement', v)} />
                      </div>
                    </Field>
                    {form.has_retirement && (
                      <Field>
                        <FieldLabel>Approx. value</FieldLabel>
                        <Input className={inputCls} value={str('retirement_value')} onChange={e => set('retirement_value', e.target.value)} placeholder="e.g. $400K" />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>Life insurance?</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo value={bool('has_life_insurance')} onChange={v => set('has_life_insurance', v)} />
                      </div>
                    </Field>
                    {form.has_life_insurance && (
                      <Field>
                        <FieldLabel>Death benefit</FieldLabel>
                        <Input className={inputCls} value={str('life_insurance_value')} onChange={e => set('life_insurance_value', e.target.value)} placeholder="e.g. $500K" />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>Business interests?</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo value={bool('has_business')} onChange={v => set('has_business', v)} />
                      </div>
                    </Field>
                    {form.has_business && (
                      <Field>
                        <FieldLabel>Description</FieldLabel>
                        <Input className={inputCls} value={str('business_description')} onChange={e => set('business_description', e.target.value)} placeholder="e.g. 50% LLC, plumbing company" />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>Investment accounts?</FieldLabel>
                      <div className="mt-1">
                        <SegmentedYesNo value={bool('has_investments')} onChange={v => set('has_investments', v)} />
                      </div>
                    </Field>
                  </Row2>
                </>
              )}

              {/* ── Section: Estate Planning Goals (EP only) ── */}
              {showEP && (
                <>
                  <GroupLabel>Estate Planning Goals</GroupLabel>
                  <div>
                    <FieldLabel>Goals &amp; wishes</FieldLabel>
                    <Textarea
                      className={textareaCls}
                      value={str('planning_objectives')}
                      onChange={e => set('planning_objectives', e.target.value)}
                      placeholder="What does the client want to accomplish with their estate plan?"
                      rows={4}
                    />
                  </div>

                  <div className="mt-3">
                    <FieldLabel>Existing documents</FieldLabel>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {[
                        { key: 'has_will' as const, label: 'Current Will' },
                        { key: 'has_trust' as const, label: 'Current Trust' },
                        { key: 'has_poa' as const, label: 'Power of Attorney' },
                        { key: 'has_hcp' as const, label: 'Healthcare Proxy' },
                      ].map(({ key, label }) => (
                        <label key={key} htmlFor={`${checkboxId}-${key}`} className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                          <Checkbox
                            id={`${checkboxId}-${key}`}
                            checked={bool(key)}
                            onCheckedChange={checked => set(key, checked === true)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <FieldLabel>Special circumstances</FieldLabel>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {[
                        'Blended family',
                        'Disabled beneficiary',
                        'Business succession',
                        'Charitable intent',
                        'Tax planning',
                        'Medicaid planning',
                      ].map(val => (
                        <label key={val} htmlFor={`${checkboxId}-${val}`} className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                          <Checkbox
                            id={`${checkboxId}-${val}`}
                            checked={form.special_circumstances.includes(val)}
                            onCheckedChange={() => toggleCircumstance(val)}
                          />
                          {val}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Section: Fiduciaries (EP + College Prep) ── */}
              {(showEP || isCollegePrep) && (
                <>
                  <GroupLabel>{isCollegePrep ? 'Agents' : 'Fiduciaries'}</GroupLabel>
                  {(isCollegePrep
                    ? [
                        { label: 'Financial agent (DPOA)', primary: 'poa_primary' as const, primaryPronouns: 'poa_primary_pronouns' as const, alt: 'poa_alternate' as const, altPronouns: 'poa_alternate_pronouns' as const },
                        { label: 'Health care agent', primary: 'hcp_primary' as const, primaryPronouns: 'hcp_primary_pronouns' as const, alt: 'hcp_alternate' as const, altPronouns: 'hcp_alternate_pronouns' as const },
                      ]
                    : [
                        { label: 'Trustee', primary: 'trustee_primary' as const, primaryPronouns: 'trustee_primary_pronouns' as const, alt: 'trustee_alternate' as const, altPronouns: 'trustee_alternate_pronouns' as const },
                        { label: 'Personal Representative / Executor', primary: 'executor_primary' as const, primaryPronouns: 'executor_primary_pronouns' as const, alt: 'executor_alternate' as const, altPronouns: 'executor_alternate_pronouns' as const },
                        { label: 'DPOA Agent', primary: 'poa_primary' as const, primaryPronouns: 'poa_primary_pronouns' as const, alt: 'poa_alternate' as const, altPronouns: 'poa_alternate_pronouns' as const },
                        { label: 'Healthcare Proxy', primary: 'hcp_primary' as const, primaryPronouns: 'hcp_primary_pronouns' as const, alt: 'hcp_alternate' as const, altPronouns: 'hcp_alternate_pronouns' as const },
                      ]
                  ).map(({ label, primary, primaryPronouns, alt, altPronouns }) => (
                    <div key={label} className="mb-3">
                      <FieldLabel>{label}</FieldLabel>
                      <Row2>
                        <Field>
                          <ContactCombobox
                            value={str(primary)}
                            onChange={(v) => set(primary, v)}
                            suggestions={intakeContacts}
                            placeholder="Primary (name)"
                          />
                          <div className="mt-1.5">
                            <PronounSelect
                              value={str(primaryPronouns)}
                              onChange={(v) => set(primaryPronouns, v)}
                              title={`${label} — primary pronouns`}
                            />
                          </div>
                        </Field>
                        <Field>
                          <ContactCombobox
                            value={str(alt)}
                            onChange={(v) => set(alt, v)}
                            suggestions={intakeContacts}
                            placeholder="Successor / alternate"
                          />
                          <div className="mt-1.5">
                            <PronounSelect
                              value={str(altPronouns)}
                              onChange={(v) => set(altPronouns, v)}
                              title={`${label} — alternate pronouns`}
                            />
                          </div>
                        </Field>
                      </Row2>
                    </div>
                  ))}

                  {showGuardian && !isCollegePrep && (
                    <div className="mb-3">
                      <FieldLabel>Guardian for minor children</FieldLabel>
                      <Row2>
                        <Field>
                          <ContactCombobox
                            value={str('guardian_primary')}
                            onChange={(v) => set('guardian_primary', v)}
                            suggestions={intakeContacts}
                            placeholder="Primary (name)"
                          />
                          <div className="mt-1.5">
                            <PronounSelect
                              value={str('guardian_primary_pronouns')}
                              onChange={(v) => set('guardian_primary_pronouns', v)}
                              title="Guardian — primary pronouns"
                            />
                          </div>
                        </Field>
                        <Field>
                          <ContactCombobox
                            value={str('guardian_alternate')}
                            onChange={(v) => set('guardian_alternate', v)}
                            suggestions={intakeContacts}
                            placeholder="Successor / alternate"
                          />
                          <div className="mt-1.5">
                            <PronounSelect
                              value={str('guardian_alternate_pronouns')}
                              onChange={(v) => set('guardian_alternate_pronouns', v)}
                              title="Guardian — alternate pronouns"
                            />
                          </div>
                        </Field>
                      </Row2>
                    </div>
                  )}
                </>
              )}

              {/* ── Section: Probate (Probate only) ── */}
              {showProbate && (
                <>
                  <GroupLabel>Probate Details</GroupLabel>
                  <Row2>
                    <Field>
                      <FieldLabel>Decedent name</FieldLabel>
                      <Input className={inputCls} value={str('pb_decedent_name')} onChange={e => set('pb_decedent_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of death</FieldLabel>
                      <Input className={inputCls} type="date" value={str('pb_date_of_death')} onChange={e => set('pb_date_of_death', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Domicile at death</FieldLabel>
                      <Input className={inputCls} value={str('pb_domicile')} onChange={e => set('pb_domicile', e.target.value)} placeholder="City, State" />
                    </Field>
                    <Field>
                      <FieldLabel>Approx. estate value</FieldLabel>
                      <Input className={inputCls} value={str('pb_estate_value')} onChange={e => set('pb_estate_value', e.target.value)} placeholder="e.g. $450K" />
                    </Field>
                    <Field span2>
                      <FieldLabel>Known assets</FieldLabel>
                      <Textarea className={textareaCls} value={str('pb_known_assets')} onChange={e => set('pb_known_assets', e.target.value)} rows={2} />
                    </Field>
                    <Field span2>
                      <FieldLabel>Known debts / liabilities</FieldLabel>
                      <Textarea className={textareaCls} value={str('pb_known_debts')} onChange={e => set('pb_known_debts', e.target.value)} rows={2} />
                    </Field>
                    <Field>
                      <FieldLabel>Petitioner relationship to decedent</FieldLabel>
                      <Input className={inputCls} value={str('pb_petitioner_relationship')} onChange={e => set('pb_petitioner_relationship', e.target.value)} placeholder="e.g. spouse, child" />
                    </Field>
                  </Row2>
                  <div className="mt-2">
                    <FieldLabel>Goals / timeline notes</FieldLabel>
                    <Textarea className={textareaCls} value={str('pb_goals_timeline')} onChange={e => set('pb_goals_timeline', e.target.value)} rows={3} />
                  </div>
                </>
              )}

              {/* ── Section: Notes ── */}
              <AdminIntakeUploadsList intakeId={currentIntakeId} />

              <GroupLabel>Internal Notes</GroupLabel>
              <Textarea
                className={textareaCls}
                value={str('special_notes')}
                onChange={e => set('special_notes', e.target.value)}
                placeholder="Notes from the consultation — anything not captured above."
                rows={4}
              />
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-border bg-card px-6 py-3.5">
          {/* Unsaved changes guard */}
          {showDiscard ? (
            <div>
              <div className="mb-2.5 text-xs text-muted-foreground">
                You have unsaved changes. Discard them?
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={doClose}>Discard</Button>
                <Button type="button" variant="outline" onClick={() => setShowDiscard(false)}>Keep editing</Button>
              </div>
            </div>
          ) : (
            <>
              {footerError && (
                <div className="mb-2.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {footerError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!isDirty || saving}
                  onClick={handleSaveDraft}
                >
                  {saving ? 'Saving…' : clientLocked ? 'Save attorney edits' : 'Save draft'}
                </Button>
                {/* A locked (submitted/approved) intake is edited in place via
                    "Save attorney edits" — never re-submitted, which would
                    re-stamp completion / re-advance the matter. */}
                {!clientLocked && (
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? 'Submitting…' : 'Submit intake'}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Map raw DB record to form data ───────────────────────────────────────────

function mapRawToForm(raw: Record<string, unknown>): AdminIntakeFormData {
  const str = (key: string): string => {
    const v = raw[key]
    return typeof v === 'string' ? v : ''
  }
  const bool = (key: string): boolean => Boolean(raw[key])

  const spouseData = (raw['_spouse'] as Record<string, unknown> | undefined) ?? {}

  const children = ((): AdminIntakeChild[] => {
    const v = raw['_children']
    if (!Array.isArray(v)) return []
    return v.map((c: Record<string, unknown>, i: number) => ({
      id: typeof c.contact_id === 'string' && c.contact_id ? c.contact_id : uid(),
      first_name: typeof c.first_name === 'string' ? c.first_name : (c.name as string ?? `Child ${i + 1}`),
      middle_name: typeof c.middle_name === 'string' ? c.middle_name : '',
      last_name: typeof c.last_name === 'string' ? c.last_name : '',
      date_of_birth: typeof c.date_of_birth === 'string' ? c.date_of_birth : (typeof c.dob === 'string' ? c.dob : ''),
      // The hydrated child entry exposes the contacts column as `pronouns`.
      preferred_pronoun:
        typeof c.preferred_pronoun === 'string'
          ? c.preferred_pronoun
          : (typeof c.pronouns === 'string' ? c.pronouns : ''),
    }))
  })()

  const financial = (raw['financial_details'] as Record<string, unknown> | null) ?? {}
  const familyDetails = (raw['family_details'] as Record<string, unknown> | null) ?? {}

  // Fiduciaries live in contact_roles (attached as _fiduciary_roles by
  // getAdminIntakeData); probate fields live in the probate_details jsonb.
  const fid = adminFiduciaryFlatFromRoles(
    Array.isArray(raw['_fiduciary_roles']) ? (raw['_fiduciary_roles'] as AdminFiduciaryRoleRow[]) : [],
  )
  const probate = probateFlatFromDetails(raw['probate_details'])

  return {
    first_name: str('first_name'),
    middle_name: str('middle_name'),
    last_name: str('last_name'),
    suffix: str('suffix'),
    date_of_birth: str('date_of_birth'),
    is_us_citizen: bool('is_us_citizen'),
    preferred_pronoun: str('preferred_pronoun'),
    phone: formatPhoneInput(str('phone')),
    email: str('email'),
    address_line1: str('address_line1'),
    address_line2: str('address_line2'),
    city: str('city'),
    state: str('state') || 'MA',
    zip: str('zip'),
    county: str('county'),
    marital_status: str('marital_status'),
    has_children: bool('has_children'),
    has_minor_children: bool('has_minor_children'),
    children,
    family_notes: typeof familyDetails.notes === 'string' ? familyDetails.notes : '',
    spouse_first_name: typeof spouseData.first_name === 'string' ? spouseData.first_name : str('spouse_first_name'),
    spouse_middle_name: typeof spouseData.middle_name === 'string' ? spouseData.middle_name : str('spouse_middle_name'),
    spouse_last_name: typeof spouseData.last_name === 'string' ? spouseData.last_name : str('spouse_last_name'),
    spouse_date_of_birth: typeof spouseData.date_of_birth === 'string' ? spouseData.date_of_birth : str('spouse_date_of_birth'),
    // Spouse citizenship defaults to yes, matching the client's own field and
    // the design sheet's "US Citizen" default.
    spouse_is_us_citizen: typeof spouseData.is_us_citizen === 'boolean' ? spouseData.is_us_citizen : true,
    spouse_preferred_pronoun:
      typeof spouseData.preferred_pronoun === 'string' ? spouseData.preferred_pronoun : '',
    spouse_phone: formatPhoneInput(typeof spouseData.phone === 'string' ? spouseData.phone : str('spouse_phone')),
    spouse_email: typeof spouseData.email === 'string' ? spouseData.email : str('spouse_email'),
    date_of_marriage: str('date_of_marriage'),
    estate_value: str('estate_value'),
    has_real_property: bool('has_real_property'),
    real_property_address: typeof financial.real_property_address === 'string' ? financial.real_property_address : '',
    real_property_value: typeof financial.real_property_value === 'string' ? financial.real_property_value : '',
    has_retirement: bool('has_retirement'),
    retirement_value: typeof financial.retirement_value === 'string' ? financial.retirement_value : '',
    has_life_insurance: bool('has_life_insurance'),
    life_insurance_value: typeof financial.life_insurance_value === 'string' ? financial.life_insurance_value : '',
    has_business: bool('has_business'),
    business_description: typeof financial.business_description === 'string' ? financial.business_description : '',
    has_investments: bool('has_investments'),
    planning_objectives: str('planning_objectives'),
    has_existing_plan: bool('has_existing_plan'),
    has_will: false,
    has_trust: false,
    has_poa: false,
    has_hcp: false,
    special_circumstances: [],
    trustee_primary: fid.trustee_primary ?? '',
    trustee_primary_pronouns: fid.trustee_primary_pronouns ?? '',
    trustee_alternate: fid.trustee_alternate ?? '',
    trustee_alternate_pronouns: fid.trustee_alternate_pronouns ?? '',
    executor_primary: fid.executor_primary ?? '',
    executor_primary_pronouns: fid.executor_primary_pronouns ?? '',
    executor_alternate: fid.executor_alternate ?? '',
    executor_alternate_pronouns: fid.executor_alternate_pronouns ?? '',
    poa_primary: fid.poa_primary ?? '',
    poa_primary_pronouns: fid.poa_primary_pronouns ?? '',
    poa_alternate: fid.poa_alternate ?? '',
    poa_alternate_pronouns: fid.poa_alternate_pronouns ?? '',
    hcp_primary: fid.hcp_primary ?? '',
    hcp_primary_pronouns: fid.hcp_primary_pronouns ?? '',
    hcp_alternate: fid.hcp_alternate ?? '',
    hcp_alternate_pronouns: fid.hcp_alternate_pronouns ?? '',
    guardian_primary: fid.guardian_primary ?? '',
    guardian_primary_pronouns: fid.guardian_primary_pronouns ?? '',
    guardian_alternate: fid.guardian_alternate ?? '',
    guardian_alternate_pronouns: fid.guardian_alternate_pronouns ?? '',
    pb_decedent_name: probate.pb_decedent_name ?? '',
    pb_date_of_death: probate.pb_date_of_death ?? '',
    pb_domicile: probate.pb_domicile ?? '',
    pb_estate_value: probate.pb_estate_value ?? '',
    pb_known_assets: probate.pb_known_assets ?? '',
    pb_known_debts: probate.pb_known_debts ?? '',
    pb_petitioner_relationship: probate.pb_petitioner_relationship ?? '',
    pb_goals_timeline: probate.pb_goals_timeline ?? '',
    special_notes: str('special_notes'),
  }
}
