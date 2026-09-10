'use client'

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldPath,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { getAdminIntakeData, saveAdminIntakeDraft, submitAdminIntake, resolveMatterIntake } from '@/app/actions/adminIntake'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'
import { mapRawIntakeToFormData } from '@/lib/intake/adminIntakeFormMapping'
import type { AdminIntakeFormData, AdminIntakeChild } from '@/types/adminIntake'
import { AddressAutocomplete, type ParsedAddress } from '@/components/address-autocomplete'
import ContactCombobox, { type ContactSuggestion } from '@/components/intake/ContactCombobox'
import { AdminIntakeUploadsList } from '@/components/admin/AdminIntakeUploadsList'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError } from '@/components/forms/FieldError'
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
import { DEFAULT_INTAKE_TRACK, getIntakeTrack, type IntakeTrack } from '@/lib/intakeTrack'
import { isCollegePrepPracticeArea } from '@/lib/practiceArea'
import { adminIntakeSubmitSchema } from '@/lib/validation/adminIntake'
import {
  MA_COUNTY_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  ESTATE_VALUE_OPTIONS,
  PRONOUN_OPTIONS,
  CITIZENSHIP_STATUS_OPTIONS,
  citizenshipStatusToLegacyBoolean,
  normalizeCitizenshipStatus,
} from '@/lib/sharedFields'

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

type AdminIntakeControl = Control<AdminIntakeFormData>
type AdminIntakeField = FieldPath<AdminIntakeFormData>

// ── Helpers ──────────────────────────────────────────────────────────────────

const isEP = (pa: string) => pa.toLowerCase().includes('estate planning') || pa === ''
const isProbate = (pa: string) => pa.toLowerCase().includes('probate')

function uid() {
  return Math.random().toString(36).slice(2)
}

function emptyChild(): AdminIntakeChild {
  return { id: uid(), first_name: '', middle_name: '', last_name: '', date_of_birth: '', preferred_pronoun: '' }
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

// Compact variants of the shared Input/Textarea density for this dense sheet.
const inputCls = 'h-[34px] px-2.5 text-[13px] md:text-[13px]'
const textareaCls = 'min-h-20 px-2.5 py-2 text-[13px] md:text-[13px]'
const errorCls = 'text-[11px]'

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

/** Yes/No segment bound to a boolean field, with an optional side effect. */
function YesNoField({
  control, name, onAfterChange,
}: {
  control: AdminIntakeControl
  name: AdminIntakeField
  onAfterChange?: (value: boolean) => void
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SegmentedYesNo
          value={Boolean(field.value)}
          onChange={value => {
            field.onChange(value)
            onAfterChange?.(value)
          }}
        />
      )}
    />
  )
}

/** Pronoun picker. Documents are generated with these, so every person the
 *  sheet captures — client, spouse, children, fiduciaries — gets one. */
function PronounField({
  control, name, title,
}: {
  control: AdminIntakeControl
  name: AdminIntakeField
  title?: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <select
          className={selectCls}
          value={String(field.value ?? '')}
          onChange={e => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          title={title}
          aria-label={title}
        >
          <option value="">Pronouns…</option>
          {PRONOUN_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    />
  )
}

/** Fiduciary / agent name picker backed by the intake's known contacts. */
function ContactField({
  control, name, suggestions, placeholder,
}: {
  control: AdminIntakeControl
  name: AdminIntakeField
  suggestions: ContactSuggestion[]
  placeholder: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ContactCombobox
          value={String(field.value ?? '')}
          onChange={field.onChange}
          suggestions={suggestions}
          placeholder={placeholder}
        />
      )}
    />
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
  const [currentIntakeId, setCurrentIntakeId] = useState<string | null>(clientIntakeId)
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null)
  const [intakeTrack, setIntakeTrack] = useState<IntakeTrack>(DEFAULT_INTAKE_TRACK)
  const [intakeContacts, setIntakeContacts] = useState<ContactSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [footerError, setFooterError] = useState('')
  const [showDiscard, setShowDiscard] = useState(false)
  const [manualAddress, setManualAddress] = useState(false)
  const [addressSearch, setAddressSearch] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const checkboxId = useId()

  // The College Preparation Plan track never asks about assets, a spouse, or a
  // trust, so this attorney form must not present those fields as if it had.
  // Its own answers (school, HIPAA scope, living will) live in the guided
  // questionnaire — this sheet stays the shared client/fiduciary editor.
  // The practice area counts as well as the stored track. Matters created
  // before the questionnaire followed the practice area still carry
  // `intake_track: 'estate'` (the column default), and reading the track alone
  // put an estate questionnaire in front of a College Preparation Plan — and
  // then demanded marital status and assets it never showed.
  const isCollegePrep = intakeTrack === 'college_prep' || isCollegePrepPracticeArea(practiceArea)

  // The submit rules differ by track, so the resolver is rebuilt when it flips.
  // useForm re-reads its options on every render, so the new one takes effect.
  const resolver = useMemo(
    () => zodResolver(adminIntakeSubmitSchema({ isCollegePrep })),
    [isCollegePrep],
  )

  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<AdminIntakeFormData>({
    defaultValues: emptyAdminIntakeFormData(),
    resolver,
  })

  const { fields: childFields, append: appendChild, remove: removeChild } = useFieldArray({
    control,
    name: 'children',
  })

  // Only the fields that gate a section are watched, so typing in the ~90 plain
  // inputs re-renders nothing but the input itself.
  const [
    maritalStatus,
    hasChildren,
    hasMinorChildren,
    hasRealProperty,
    hasRetirement,
    hasLifeInsurance,
    hasBusiness,
  ] = useWatch({
    control,
    name: [
      'marital_status',
      'has_children',
      'has_minor_children',
      'has_real_property',
      'has_retirement',
      'has_life_insurance',
      'has_business',
    ],
  })

  const showEP = isEP(practiceArea) && !isCollegePrep
  const showProbate = isProbate(practiceArea) && !isCollegePrep
  const showSpouse = maritalStatus === 'married'
  const showGuardian = hasMinorChildren
  const clientLocked = intakeStatus === 'submitted' || intakeStatus === 'approved'

  const setField = useCallback(
    (name: AdminIntakeField, value: unknown) => {
      // shouldDirty keeps the footer's save button and the close guard honest
      // for the fields that are written programmatically rather than typed.
      setValue(name, value as never, { shouldDirty: true })
    },
    [setValue],
  )

  // ── Load initial data when sheet opens ────────────────────────────────────
  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function loadIntake(idToLoad: string) {
      setLoading(true)
      try {
        const raw = await getAdminIntakeData(idToLoad)
        if (cancelled || !raw) return
        reset(mapRawIntakeToFormData(raw))
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
        reset({ ...emptyAdminIntakeFormData(), first_name: first, last_name: last })
        setCurrentIntakeId(null)
        setIntakeStatus(null)
        return
      }

      reset(emptyAdminIntakeFormData())
      setCurrentIntakeId(null)
      setIntakeStatus(null)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [open, clientIntakeId, clientName, matterId, onIntakeIdChange, reset])

  // Sync currentIntakeId if prop changes
  useEffect(() => {
    setCurrentIntakeId(clientIntakeId)
  }, [clientIntakeId])

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
    setFooterError('')
    reset(emptyAdminIntakeFormData())
    setCurrentIntakeId(null)
    setIntakeStatus(null)
    setIntakeTrack(DEFAULT_INTAKE_TRACK)
    onClose()
  }

  // ── Save draft ─────────────────────────────────────────────────────────────
  // Deliberately unvalidated: a draft is a partial intake by definition.
  // Returns the saved intake id so callers that need a persisted row (the Word
  // export reads the saved record) can chain off a successful save.
  async function handleSaveDraft(): Promise<string | null> {
    setSaving(true)
    setFooterError('')
    const data = getValues()
    try {
      const result = await saveAdminIntakeDraft({ leadId, matterId, clientIntakeId: currentIntakeId, clientUserId, data })
      setCurrentIntakeId(result.id)
      onIntakeIdChange?.(result.id)
      // Re-baseline so the saved values are no longer "unsaved changes".
      reset(data)
      setIntakeStatus(prev => (prev === 'submitted' || prev === 'approved' ? prev : 'draft'))
      toast.success(clientLocked ? 'Attorney edits saved' : 'Draft saved')
      return result.id
    } catch (err) {
      setFooterError((err as Error).message)
      return null
    } finally {
      setSaving(false)
    }
  }

  // ── Export to Word ─────────────────────────────────────────────────────────
  // The route renders the saved row, so unsaved edits are persisted first —
  // otherwise the download would quietly omit what is on screen.
  async function handleExportWord() {
    if (!currentIntakeId) return
    setFooterError('')
    const intakeIdForExport = isDirty ? await handleSaveDraft() : currentIntakeId
    if (!intakeIdForExport) return

    setExporting(true)
    try {
      const query = practiceArea ? `?practiceArea=${encodeURIComponent(practiceArea)}` : ''
      const response = await fetch(`/api/admin/intake/${intakeIdForExport}/export${query}`)
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(result.error ?? 'Unable to export intake form')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'intake-form.docx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Intake form exported')
    } catch (err) {
      setFooterError((err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  // ── Submit intake ──────────────────────────────────────────────────────────
  async function onSubmit(data: AdminIntakeFormData) {
    setFooterError('')
    try {
      const result = await submitAdminIntake({ leadId, matterId, clientIntakeId: currentIntakeId, clientUserId, data })
      setCurrentIntakeId(result.id)
      onIntakeIdChange?.(result.id)
      toast.success('Intake submitted')
      doClose()
      onSubmitted()
    } catch (err) {
      setFooterError((err as Error).message)
    }
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

              <Row2>
                <Field>
                  <FieldLabel required>First Name</FieldLabel>
                  <Input
                    className={inputCls}
                    aria-invalid={Boolean(errors.first_name)}
                    {...register('first_name')}
                  />
                  <FieldError className={errorCls} message={errors.first_name?.message} />
                </Field>
                <Field>
                  <FieldLabel>Middle Name</FieldLabel>
                  <Input className={inputCls} {...register('middle_name')} />
                </Field>
                <Field>
                  <FieldLabel required>Last Name</FieldLabel>
                  <Input
                    className={inputCls}
                    aria-invalid={Boolean(errors.last_name)}
                    {...register('last_name')}
                  />
                  <FieldError className={errorCls} message={errors.last_name?.message} />
                </Field>
                <Field>
                  <FieldLabel>Suffix</FieldLabel>
                  <select className={selectCls} {...register('suffix')}>
                    <option value="">—</option>
                    {['Jr.', 'Sr.', 'II', 'III', 'IV', 'Esq.'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field>
                  <FieldLabel>Date of Birth</FieldLabel>
                  <Input className={inputCls} type="date" {...register('date_of_birth')} />
                </Field>
                <Field>
                  <FieldLabel>Citizenship / immigration status</FieldLabel>
                  <Controller
                    control={control}
                    name="citizenship_status"
                    render={({ field }) => (
                      <select
                        className={selectCls}
                        value={field.value}
                        onBlur={field.onBlur}
                        onChange={e => {
                          const status = normalizeCitizenshipStatus(e.target.value)
                          field.onChange(status)
                          setField('is_us_citizen', citizenshipStatusToLegacyBoolean(status))
                        }}
                      >
                        {CITIZENSHIP_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    )}
                  />
                </Field>
                <Field>
                  <FieldLabel>Pronouns</FieldLabel>
                  <PronounField control={control} name="preferred_pronoun" title="Client pronouns" />
                </Field>
                <Field>
                  <FieldLabel required>Email</FieldLabel>
                  <Input
                    className={inputCls}
                    type="email"
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                  <FieldError className={errorCls} message={errors.email?.message} />
                </Field>
                <Field>
                  <FieldLabel>Phone</FieldLabel>
                  {/* Input runs formatPhoneInput on type="tel" before onChange. */}
                  <Input
                    className={inputCls}
                    type="tel"
                    autoComplete="tel"
                    placeholder="(555) 555-5555"
                    {...register('phone')}
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
                      setField('address_line1', parsed.address_line1)
                      setField('city', parsed.city)
                      setField('state', parsed.state || 'MA')
                      setField('zip', parsed.zip)
                      if (parsed.county) setField('county', parsed.county)
                    }}
                    className="mb-2"
                  />
                )}
                <FieldLabel>Street Address</FieldLabel>
                <Input
                  className={cn(inputCls, 'mb-2')}
                  autoComplete="address-line1"
                  placeholder="Street address"
                  {...register('address_line1')}
                />
                <Input
                  className={inputCls}
                  autoComplete="address-line2"
                  placeholder="Apt, unit, etc. (optional)"
                  {...register('address_line2')}
                />
              </div>
              <Row2 className="mt-2">
                <Field>
                  <FieldLabel>City</FieldLabel>
                  <Input className={inputCls} autoComplete="address-level2" {...register('city')} />
                </Field>
                <Field>
                  <FieldLabel>State</FieldLabel>
                  <Input className={inputCls} autoComplete="address-level1" {...register('state')} />
                </Field>
                <Field>
                  <FieldLabel>ZIP</FieldLabel>
                  <Input className={inputCls} autoComplete="postal-code" {...register('zip')} />
                </Field>
                <Field>
                  <FieldLabel>County</FieldLabel>
                  <select className={selectCls} {...register('county')}>
                    <option value="">Select county</option>
                    {MA_COUNTY_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </Row2>

              {/* Marital status */}
              <div className="mt-3">
                <FieldLabel required>Marital Status</FieldLabel>
                <select
                  className={selectCls}
                  aria-invalid={Boolean(errors.marital_status)}
                  {...register('marital_status')}
                >
                  <option value="">Select…</option>
                  {MARITAL_STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <FieldError className={errorCls} message={errors.marital_status?.message} />
              </div>

              {/* ── Section: Spouse ── */}
              {showSpouse && !isCollegePrep && (
                <>
                  <GroupLabel>Spouse / Partner</GroupLabel>
                  <Row2>
                    <Field>
                      <FieldLabel>First Name</FieldLabel>
                      <Input className={inputCls} {...register('spouse_first_name')} />
                    </Field>
                    <Field>
                      <FieldLabel>Middle Name</FieldLabel>
                      <Input className={inputCls} {...register('spouse_middle_name')} />
                    </Field>
                    <Field>
                      <FieldLabel>Last Name</FieldLabel>
                      <Input className={inputCls} {...register('spouse_last_name')} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of Birth</FieldLabel>
                      <Input className={inputCls} type="date" {...register('spouse_date_of_birth')} />
                    </Field>
                    <Field>
                      <FieldLabel>Citizenship / immigration status</FieldLabel>
                      <Controller
                        control={control}
                        name="spouse_citizenship_status"
                        render={({ field }) => (
                          <select
                            className={selectCls}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={e => {
                              const status = normalizeCitizenshipStatus(e.target.value)
                              field.onChange(status)
                              setField('spouse_is_us_citizen', citizenshipStatusToLegacyBoolean(status))
                            }}
                          >
                            {CITIZENSHIP_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        )}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Pronouns</FieldLabel>
                      <PronounField control={control} name="spouse_preferred_pronoun" title="Spouse pronouns" />
                    </Field>
                    <Field>
                      <FieldLabel>Date of Marriage</FieldLabel>
                      <Input className={inputCls} type="date" {...register('date_of_marriage')} />
                    </Field>
                    <Field>
                      <FieldLabel>Email</FieldLabel>
                      <Input className={inputCls} type="email" {...register('spouse_email')} />
                    </Field>
                    <Field>
                      <FieldLabel>Phone</FieldLabel>
                      <Input
                        className={inputCls}
                        type="tel"
                        placeholder="(555) 555-5555"
                        {...register('spouse_phone')}
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
                        <YesNoField
                          control={control}
                          name="has_children"
                          onAfterChange={value => {
                            if (!value) {
                              setField('has_minor_children', false)
                              setField('children', [])
                            }
                          }}
                        />
                      </div>
                    </Field>
                    {hasChildren && (
                      <Field>
                        <FieldLabel>Minor children (under 18)?</FieldLabel>
                        <div className="mt-1">
                          <YesNoField control={control} name="has_minor_children" />
                        </div>
                      </Field>
                    )}
                  </Row2>

                  {hasChildren && (
                    <div className="mt-3">
                      <FieldLabel>Children</FieldLabel>
                      {childFields.map((child, idx) => (
                        <div key={child.id} className="mb-2 flex items-center gap-2">
                          <Input
                            className={cn(inputCls, 'flex-1')}
                            placeholder="First name"
                            {...register(`children.${idx}.first_name`)}
                          />
                          <Input
                            className={cn(inputCls, 'flex-1')}
                            placeholder="Middle name"
                            {...register(`children.${idx}.middle_name`)}
                          />
                          <Input
                            className={cn(inputCls, 'flex-1')}
                            placeholder="Last name"
                            {...register(`children.${idx}.last_name`)}
                          />
                          <Input
                            className={cn(inputCls, 'w-[130px] flex-none')}
                            type="date"
                            title={`Child ${idx + 1} date of birth`}
                            {...register(`children.${idx}.date_of_birth`)}
                          />
                          <div className="w-[120px] flex-none">
                            <PronounField
                              control={control}
                              name={`children.${idx}.preferred_pronoun`}
                              title={`Child ${idx + 1} pronouns`}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-muted-foreground"
                            aria-label={`Remove child ${idx + 1}`}
                            onClick={() => removeChild(idx)}
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
                        onClick={() => appendChild(emptyChild())}
                      >
                        + Add child
                      </Button>
                    </div>
                  )}

                  <div className="mt-3">
                    <FieldLabel>Family notes</FieldLabel>
                    <Textarea
                      className={textareaCls}
                      placeholder="Notes about dependents, blended family, or other family complexity…"
                      rows={3}
                      {...register('family_notes')}
                    />
                  </div>
                </>
              )}

              {/* ── Section: Assets (not asked on the College Prep track) ── */}
              {!isCollegePrep && (
                <>
                  <GroupLabel>Assets</GroupLabel>
                  <div className="mb-3">
                    <FieldLabel>Approximate estate value</FieldLabel>
                    <select
                      className={selectCls}
                      aria-invalid={Boolean(errors.estate_value)}
                      {...register('estate_value')}
                    >
                      <option value="">Select range…</option>
                      {ESTATE_VALUE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <FieldError className={errorCls} message={errors.estate_value?.message} />
                  </div>

                  <Row2>
                    <Field>
                      <FieldLabel>Real property?</FieldLabel>
                      <div className="mt-1">
                        <YesNoField control={control} name="has_real_property" />
                      </div>
                    </Field>
                    {hasRealProperty && (
                      <Field>
                        <FieldLabel>Approx. property value</FieldLabel>
                        <Input className={inputCls} placeholder="e.g. $650K" {...register('real_property_value')} />
                      </Field>
                    )}
                  </Row2>
                  {hasRealProperty && (
                    <div className="mt-2">
                      <FieldLabel>Property address</FieldLabel>
                      <Input className={inputCls} {...register('real_property_address')} />
                    </div>
                  )}

                  <Row2 className="mt-3">
                    <Field>
                      <FieldLabel>Retirement accounts?</FieldLabel>
                      <div className="mt-1">
                        <YesNoField control={control} name="has_retirement" />
                      </div>
                    </Field>
                    {hasRetirement && (
                      <Field>
                        <FieldLabel>Approx. value</FieldLabel>
                        <Input className={inputCls} placeholder="e.g. $400K" {...register('retirement_value')} />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>Life insurance?</FieldLabel>
                      <div className="mt-1">
                        <YesNoField control={control} name="has_life_insurance" />
                      </div>
                    </Field>
                    {hasLifeInsurance && (
                      <Field>
                        <FieldLabel>Death benefit</FieldLabel>
                        <Input className={inputCls} placeholder="e.g. $500K" {...register('life_insurance_value')} />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>Business interests?</FieldLabel>
                      <div className="mt-1">
                        <YesNoField control={control} name="has_business" />
                      </div>
                    </Field>
                    {hasBusiness && (
                      <Field>
                        <FieldLabel>Description</FieldLabel>
                        <Input className={inputCls} placeholder="e.g. 50% LLC, plumbing company" {...register('business_description')} />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>Investment accounts?</FieldLabel>
                      <div className="mt-1">
                        <YesNoField control={control} name="has_investments" />
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
                      placeholder="What does the client want to accomplish with their estate plan?"
                      rows={4}
                      {...register('planning_objectives')}
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
                          <Controller
                            control={control}
                            name={key}
                            render={({ field }) => (
                              <Checkbox
                                id={`${checkboxId}-${key}`}
                                checked={Boolean(field.value)}
                                onCheckedChange={checked => field.onChange(checked === true)}
                              />
                            )}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <FieldLabel>Special circumstances</FieldLabel>
                    <Controller
                      control={control}
                      name="special_circumstances"
                      render={({ field }) => (
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
                                checked={field.value.includes(val)}
                                onCheckedChange={() =>
                                  field.onChange(
                                    field.value.includes(val)
                                      ? field.value.filter(c => c !== val)
                                      : [...field.value, val],
                                  )
                                }
                              />
                              {val}
                            </label>
                          ))}
                        </div>
                      )}
                    />
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
                          <ContactField
                            control={control}
                            name={primary}
                            suggestions={intakeContacts}
                            placeholder="Primary (name)"
                          />
                          <div className="mt-1.5">
                            <PronounField
                              control={control}
                              name={primaryPronouns}
                              title={`${label} — primary pronouns`}
                            />
                          </div>
                        </Field>
                        <Field>
                          <ContactField
                            control={control}
                            name={alt}
                            suggestions={intakeContacts}
                            placeholder="Successor / alternate"
                          />
                          <div className="mt-1.5">
                            <PronounField
                              control={control}
                              name={altPronouns}
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
                          <ContactField
                            control={control}
                            name="guardian_primary"
                            suggestions={intakeContacts}
                            placeholder="Primary (name)"
                          />
                          <div className="mt-1.5">
                            <PronounField
                              control={control}
                              name="guardian_primary_pronouns"
                              title="Guardian — primary pronouns"
                            />
                          </div>
                        </Field>
                        <Field>
                          <ContactField
                            control={control}
                            name="guardian_alternate"
                            suggestions={intakeContacts}
                            placeholder="Successor / alternate"
                          />
                          <div className="mt-1.5">
                            <PronounField
                              control={control}
                              name="guardian_alternate_pronouns"
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
                      <Input className={inputCls} {...register('pb_decedent_name')} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of death</FieldLabel>
                      <Input className={inputCls} type="date" {...register('pb_date_of_death')} />
                    </Field>
                    <Field>
                      <FieldLabel>Domicile at death</FieldLabel>
                      <Input className={inputCls} placeholder="City, State" {...register('pb_domicile')} />
                    </Field>
                    <Field>
                      <FieldLabel>Approx. estate value</FieldLabel>
                      <Input className={inputCls} placeholder="e.g. $450K" {...register('pb_estate_value')} />
                    </Field>
                    <Field span2>
                      <FieldLabel>Known assets</FieldLabel>
                      <Textarea className={textareaCls} rows={2} {...register('pb_known_assets')} />
                    </Field>
                    <Field span2>
                      <FieldLabel>Known debts / liabilities</FieldLabel>
                      <Textarea className={textareaCls} rows={2} {...register('pb_known_debts')} />
                    </Field>
                    <Field>
                      <FieldLabel>Petitioner relationship to decedent</FieldLabel>
                      <Input className={inputCls} placeholder="e.g. spouse, child" {...register('pb_petitioner_relationship')} />
                    </Field>
                  </Row2>
                  <div className="mt-2">
                    <FieldLabel>Goals / timeline notes</FieldLabel>
                    <Textarea className={textareaCls} rows={3} {...register('pb_goals_timeline')} />
                  </div>
                </>
              )}

              {/* ── Section: Notes ── */}
              <AdminIntakeUploadsList intakeId={currentIntakeId} />

              <GroupLabel>Internal Notes</GroupLabel>
              <Textarea
                className={textareaCls}
                placeholder="Notes from the consultation — anything not captured above."
                rows={4}
                {...register('special_notes')}
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
              <div className="flex items-center justify-between gap-2">
                {/* Word export of the intake as the attorney sees it — the
                    printable copy for a consultation or the client file. */}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!currentIntakeId || exporting || saving}
                  title={currentIntakeId ? undefined : 'Save the intake before exporting'}
                  onClick={() => void handleExportWord()}
                >
                  {exporting ? 'Exporting…' : 'Export Word'}
                </Button>
                <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!isDirty || saving}
                  onClick={() => void handleSaveDraft()}
                >
                  {saving ? 'Saving…' : clientLocked ? 'Save attorney edits' : 'Save draft'}
                </Button>
                {/* A locked (submitted/approved) intake is edited in place via
                    "Save attorney edits" — never re-submitted, which would
                    re-stamp completion / re-advance the matter. */}
                {!clientLocked && (
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSubmit(onSubmit)()}
                  >
                    {isSubmitting ? 'Submitting…' : 'Submit intake'}
                  </Button>
                )}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
