'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { getAdminIntakeData, saveAdminIntakeDraft, submitAdminIntake, resolveMatterIntake } from '@/app/actions/adminIntake'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'
import type { AdminIntakeFormData, AdminIntakeChild } from '@/types/adminIntake'
import { AddressAutocomplete, type ParsedAddress } from '@/components/address-autocomplete'
import ContactCombobox, { type ContactSuggestion } from '@/components/intake/ContactCombobox'
import { AdminIntakeUploadsList } from '@/components/admin/AdminIntakeUploadsList'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatPhoneInput } from '@/lib/phone'
import { MA_COUNTY_OPTIONS, MARITAL_STATUS_OPTIONS, ESTATE_VALUE_OPTIONS } from '@/lib/sharedFields'
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
    <div style={{
      fontSize: 11, fontWeight: 500, textTransform: 'uppercase' as const,
      letterSpacing: '0.05em', color: 'var(--muted-foreground)',
      marginTop: 24, marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: 4 }}>
      {children}{required && <span style={{ color: 'var(--destructive)', marginLeft: 2 }}>*</span>}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <div style={{ fontSize: 11, color: 'var(--destructive)', marginTop: 3 }}>{message}</div>
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box' as const,
  height: 34,
  padding: '0 10px',
  fontSize: 13,
  fontWeight: 400,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--foreground)',
  outline: 'none',
}

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  border: '1px solid var(--destructive)',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '8px 10px',
  fontSize: 13,
  fontWeight: 400,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--foreground)',
  outline: 'none',
  resize: 'vertical' as const,
  minHeight: 80,
  fontFamily: 'inherit',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
  paddingRight: 28,
  cursor: 'pointer',
}

function SegmentedYesNo({
  value, onChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  const activeStyle: React.CSSProperties = {
    padding: '4px 14px', fontSize: 12, fontWeight: 500, borderRadius: 5,
    border: 'none', background: 'var(--accent)', color: 'var(--accent-foreground)',
    cursor: 'pointer',
  }
  const inactiveStyle: React.CSSProperties = {
    padding: '4px 14px', fontSize: 12, fontWeight: 500, borderRadius: 5,
    border: 'none', background: 'transparent', color: 'var(--muted-foreground)',
    cursor: 'pointer',
  }
  return (
    <div style={{ display: 'inline-flex', background: 'var(--muted)', borderRadius: 6, padding: 2, gap: 2 }}>
      <button type="button" style={value ? activeStyle : inactiveStyle} onClick={() => onChange(true)}>Yes</button>
      <button type="button" style={!value ? activeStyle : inactiveStyle} onClick={() => onChange(false)}>No</button>
    </div>
  )
}

// ── Field-level wrapper with optional two-column grid ─────────────────────────

function Row2({ children, mt }: { children: React.ReactNode; mt?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: mt }}>
      {children}
    </div>
  )
}

function Field({ children, span2 }: { children: React.ReactNode; span2?: boolean }) {
  return <div style={span2 ? { gridColumn: '1 / -1' } : {}}>{children}</div>
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

  const showEP = isEP(practiceArea)
  const showProbate = isProbate(practiceArea)
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
    onClose()
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): boolean {
    const e: Partial<Record<keyof AdminIntakeFormData, string>> = {}
    if (!form.first_name.trim()) e.first_name = 'Required'
    if (!form.last_name.trim()) e.last_name = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    if (!form.marital_status) e.marital_status = 'Required'
    const hasAsset = form.has_real_property || form.has_retirement || form.has_investments ||
      form.has_business || form.has_life_insurance || form.estate_value
    if (!hasAsset) e.estate_value = 'At least one asset field is required'
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
    set('children', [...form.children, { id: uid(), first_name: '', middle_name: '', last_name: '', date_of_birth: '' }])
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

  // ── Styles ────────────────────────────────────────────────────────────────
  const headerStyle: React.CSSProperties = {
    flexShrink: 0,
    padding: '20px 24px 16px',
    borderBottom: '1px solid var(--border)',
    gap: 3,
  }
  const bodyStyle: React.CSSProperties = {
    flex: 1, overflowY: 'auto', padding: 24,
  }
  const footerStyle: React.CSSProperties = {
    flexShrink: 0,
    padding: '14px 24px',
    borderTop: '1px solid var(--border)',
    background: 'var(--card)',
  }
  const btnSecondary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', height: 34, padding: '0 14px',
    fontSize: 13, fontWeight: 500, borderRadius: 6,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--foreground)', cursor: 'pointer',
  }
  const btnSecondaryDisabled: React.CSSProperties = {
    ...btnSecondary, opacity: 0.4, cursor: 'not-allowed',
  }
  const btnPrimary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', height: 34, padding: '0 18px',
    fontSize: 13, fontWeight: 500, borderRadius: 6,
    border: 'none', background: 'var(--accent)', color: 'var(--accent-foreground)',
    cursor: 'pointer',
  }
  const btnDanger: React.CSSProperties = {
    ...btnSecondary, color: 'var(--destructive)', borderColor: 'var(--destructive)',
  }

  return (
    <Sheet open={open} onOpenChange={nextOpen => { if (!nextOpen) requestClose() }}>
      <SheetContent side="right" className="w-[520px] max-w-[100vw] gap-0 border-l bg-card p-0 sm:max-w-[520px]">
        {/* ── Header ── */}
        <SheetHeader style={headerStyle}>
          <SheetTitle style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)', lineHeight: 1.3 }}>
            Intake — {clientName || 'Client'}
          </SheetTitle>
          <SheetDescription style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 3 }}>
            Filling out on behalf of client
          </SheetDescription>
        </SheetHeader>

        {/* ── Body ── */}
        <div ref={bodyRef} style={bodyStyle}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted-foreground)', fontSize: 13 }}>
              Loading intake data…
            </div>
          ) : (
            <>
              {/* ── Section: Client information ── */}
              <GroupLabel>Client Information</GroupLabel>

              {/* first/last error anchor */}
              {(errors.first_name || errors.last_name) && <div ref={firstErrorRef} />}

              <Row2>
                <Field>
                  <FieldLabel required>First Name</FieldLabel>
                  <input
                    style={errors.first_name ? inputErrorStyle : inputStyle}
                    value={str('first_name')}
                    onChange={e => set('first_name', e.target.value)}
                  />
                  <FieldError message={errors.first_name} />
                </Field>
                <Field>
                  <FieldLabel>Middle Name</FieldLabel>
                  <input style={inputStyle} value={str('middle_name')} onChange={e => set('middle_name', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel required>Last Name</FieldLabel>
                  <input
                    style={errors.last_name ? inputErrorStyle : inputStyle}
                    value={str('last_name')}
                    onChange={e => set('last_name', e.target.value)}
                  />
                  <FieldError message={errors.last_name} />
                </Field>
                <Field>
                  <FieldLabel>Suffix</FieldLabel>
                  <select style={selectStyle} value={str('suffix')} onChange={e => set('suffix', e.target.value)}>
                    <option value="">—</option>
                    {['Jr.', 'Sr.', 'II', 'III', 'IV', 'Esq.'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field>
                  <FieldLabel>Date of Birth</FieldLabel>
                  <input style={inputStyle} type="date" value={str('date_of_birth')} onChange={e => set('date_of_birth', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>US Citizen</FieldLabel>
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('is_us_citizen')} onChange={v => set('is_us_citizen', v)} />
                  </div>
                </Field>
                <Field>
                  <FieldLabel required>Email</FieldLabel>
                  <input
                    style={errors.email ? inputErrorStyle : inputStyle}
                    type="email"
                    value={str('email')}
                    onChange={e => set('email', e.target.value)}
                  />
                  <FieldError message={errors.email} />
                </Field>
                <Field>
                  <FieldLabel>Phone</FieldLabel>
                  <input
                    style={inputStyle}
                    type="tel"
                    autoComplete="tel"
                    value={str('phone')}
                    onChange={e => set('phone', formatPhoneInput(e.target.value))}
                    placeholder="(555) 555-5555"
                  />
                </Field>
              </Row2>

              {/* Address */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <FieldLabel>Search Address</FieldLabel>
                  <button
                    type="button"
                    onClick={() => setManualAddress(v => !v)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', padding: 0 }}
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
                <input
                  style={{ ...inputStyle, marginBottom: 8 }}
                  name="address-line1"
                  autoComplete="address-line1"
                  value={str('address_line1')}
                  onChange={e => set('address_line1', e.target.value)}
                  placeholder="Street address"
                />
                <input
                  style={inputStyle}
                  name="address-line2"
                  autoComplete="address-line2"
                  value={str('address_line2')}
                  onChange={e => set('address_line2', e.target.value)}
                  placeholder="Apt, unit, etc. (optional)"
                />
              </div>
              <Row2 mt={8}>
                <Field>
                  <FieldLabel>City</FieldLabel>
                  <input style={inputStyle} name="address-level2" autoComplete="address-level2" value={str('city')} onChange={e => set('city', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>State</FieldLabel>
                  <input style={inputStyle} name="address-level1" autoComplete="address-level1" value={str('state')} onChange={e => set('state', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>ZIP</FieldLabel>
                  <input style={inputStyle} name="postal-code" autoComplete="postal-code" value={str('zip')} onChange={e => set('zip', e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>County</FieldLabel>
                  <select style={selectStyle} value={str('county')} onChange={e => set('county', e.target.value)}>
                    <option value="">Select county</option>
                    {MA_COUNTY_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </Row2>

              {/* Marital status */}
              <div style={{ marginTop: 12 }}>
                {errors.marital_status && <div ref={firstErrorRef} />}
                <FieldLabel required>Marital Status</FieldLabel>
                <select
                  style={errors.marital_status ? { ...selectStyle, border: '1px solid var(--destructive)' } : selectStyle}
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
              {showSpouse && (
                <>
                  <GroupLabel>Spouse / Partner</GroupLabel>
                  <Row2>
                    <Field>
                      <FieldLabel>First Name</FieldLabel>
                      <input style={inputStyle} value={str('spouse_first_name')} onChange={e => set('spouse_first_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Middle Name</FieldLabel>
                      <input style={inputStyle} value={str('spouse_middle_name')} onChange={e => set('spouse_middle_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Last Name</FieldLabel>
                      <input style={inputStyle} value={str('spouse_last_name')} onChange={e => set('spouse_last_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of Birth</FieldLabel>
                      <input style={inputStyle} type="date" value={str('spouse_date_of_birth')} onChange={e => set('spouse_date_of_birth', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of Marriage</FieldLabel>
                      <input style={inputStyle} type="date" value={str('date_of_marriage')} onChange={e => set('date_of_marriage', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Email</FieldLabel>
                      <input style={inputStyle} type="email" value={str('spouse_email')} onChange={e => set('spouse_email', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Phone</FieldLabel>
                      <input
                        style={inputStyle}
                        type="tel"
                        value={str('spouse_phone')}
                        onChange={e => set('spouse_phone', formatPhoneInput(e.target.value))}
                        placeholder="(555) 555-5555"
                      />
                    </Field>
                  </Row2>
                </>
              )}

              {/* ── Section: Family ── */}
              <GroupLabel>Family</GroupLabel>
              <Row2>
                <Field>
                  <FieldLabel>Children?</FieldLabel>
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('has_children')} onChange={v => { set('has_children', v); if (!v) { set('has_minor_children', false); set('children', []) } }} />
                  </div>
                </Field>
                {form.has_children && (
                  <Field>
                    <FieldLabel>Minor children (under 18)?</FieldLabel>
                    <div style={{ marginTop: 4 }}>
                      <SegmentedYesNo value={bool('has_minor_children')} onChange={v => set('has_minor_children', v)} />
                    </div>
                  </Field>
                )}
              </Row2>

              {form.has_children && (
                <div style={{ marginTop: 12 }}>
                  <FieldLabel>Children</FieldLabel>
                  {form.children.map((child, idx) => (
                    <div key={child.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        placeholder="First name"
                        value={child.first_name}
                        onChange={e => updateChild(child.id, 'first_name', e.target.value)}
                      />
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        placeholder="Middle name"
                        value={child.middle_name}
                        onChange={e => updateChild(child.id, 'middle_name', e.target.value)}
                      />
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        placeholder="Last name"
                        value={child.last_name}
                        onChange={e => updateChild(child.id, 'last_name', e.target.value)}
                      />
                      <input
                        style={{ ...inputStyle, width: 130, flex: 'none' }}
                        type="date"
                        value={child.date_of_birth}
                        onChange={e => updateChild(child.id, 'date_of_birth', e.target.value)}
                        title={`Child ${idx + 1} date of birth`}
                      />
                      <button
                        type="button"
                        onClick={() => removeChild(child.id)}
                        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-foreground)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addChild}
                    style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}
                  >
                    + Add child
                  </button>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <FieldLabel>Family notes</FieldLabel>
                <textarea
                  style={textareaStyle}
                  value={str('family_notes')}
                  onChange={e => set('family_notes', e.target.value)}
                  placeholder="Notes about dependents, blended family, or other family complexity…"
                  rows={3}
                />
              </div>

              {/* ── Section: Assets ── */}
              <GroupLabel>Assets</GroupLabel>
              <div style={{ marginBottom: 12 }}>
                {errors.estate_value && <div ref={firstErrorRef} />}
                <FieldLabel>Approximate estate value</FieldLabel>
                <select
                  style={errors.estate_value ? { ...selectStyle, border: '1px solid var(--destructive)' } : selectStyle}
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
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('has_real_property')} onChange={v => set('has_real_property', v)} />
                  </div>
                </Field>
                {form.has_real_property && (
                  <Field>
                    <FieldLabel>Approx. property value</FieldLabel>
                    <input style={inputStyle} value={str('real_property_value')} onChange={e => set('real_property_value', e.target.value)} placeholder="e.g. $650K" />
                  </Field>
                )}
              </Row2>
              {form.has_real_property && (
                <div style={{ marginTop: 8 }}>
                  <FieldLabel>Property address</FieldLabel>
                  <input style={inputStyle} value={str('real_property_address')} onChange={e => set('real_property_address', e.target.value)} />
                </div>
              )}

              <Row2 mt={12}>
                <Field>
                  <FieldLabel>Retirement accounts?</FieldLabel>
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('has_retirement')} onChange={v => set('has_retirement', v)} />
                  </div>
                </Field>
                {form.has_retirement && (
                  <Field>
                    <FieldLabel>Approx. value</FieldLabel>
                    <input style={inputStyle} value={str('retirement_value')} onChange={e => set('retirement_value', e.target.value)} placeholder="e.g. $400K" />
                  </Field>
                )}
                <Field>
                  <FieldLabel>Life insurance?</FieldLabel>
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('has_life_insurance')} onChange={v => set('has_life_insurance', v)} />
                  </div>
                </Field>
                {form.has_life_insurance && (
                  <Field>
                    <FieldLabel>Death benefit</FieldLabel>
                    <input style={inputStyle} value={str('life_insurance_value')} onChange={e => set('life_insurance_value', e.target.value)} placeholder="e.g. $500K" />
                  </Field>
                )}
                <Field>
                  <FieldLabel>Business interests?</FieldLabel>
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('has_business')} onChange={v => set('has_business', v)} />
                  </div>
                </Field>
                {form.has_business && (
                  <Field>
                    <FieldLabel>Description</FieldLabel>
                    <input style={inputStyle} value={str('business_description')} onChange={e => set('business_description', e.target.value)} placeholder="e.g. 50% LLC, plumbing company" />
                  </Field>
                )}
                <Field>
                  <FieldLabel>Investment accounts?</FieldLabel>
                  <div style={{ marginTop: 4 }}>
                    <SegmentedYesNo value={bool('has_investments')} onChange={v => set('has_investments', v)} />
                  </div>
                </Field>
              </Row2>

              {/* ── Section: Estate Planning Goals (EP only) ── */}
              {showEP && (
                <>
                  <GroupLabel>Estate Planning Goals</GroupLabel>
                  <div>
                    <FieldLabel>Goals &amp; wishes</FieldLabel>
                    <textarea
                      style={textareaStyle}
                      value={str('planning_objectives')}
                      onChange={e => set('planning_objectives', e.target.value)}
                      placeholder="What does the client want to accomplish with their estate plan?"
                      rows={4}
                    />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <FieldLabel>Existing documents</FieldLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                      {[
                        { key: 'has_will' as const, label: 'Current Will' },
                        { key: 'has_trust' as const, label: 'Current Trust' },
                        { key: 'has_poa' as const, label: 'Power of Attorney' },
                        { key: 'has_hcp' as const, label: 'Healthcare Proxy' },
                      ].map(({ key, label }) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--foreground)' }}>
                          <input
                            type="checkbox"
                            checked={bool(key)}
                            onChange={e => set(key, e.target.checked)}
                            style={{ width: 14, height: 14, cursor: 'pointer' }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <FieldLabel>Special circumstances</FieldLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                      {[
                        'Blended family',
                        'Disabled beneficiary',
                        'Business succession',
                        'Charitable intent',
                        'Tax planning',
                        'Medicaid planning',
                      ].map(val => (
                        <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--foreground)' }}>
                          <input
                            type="checkbox"
                            checked={form.special_circumstances.includes(val)}
                            onChange={() => toggleCircumstance(val)}
                            style={{ width: 14, height: 14, cursor: 'pointer' }}
                          />
                          {val}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Section: Fiduciaries (EP only) ── */}
              {showEP && (
                <>
                  <GroupLabel>Fiduciaries</GroupLabel>
                  {[
                    { label: 'Trustee', primary: 'trustee_primary' as const, alt: 'trustee_alternate' as const },
                    { label: 'Personal Representative / Executor', primary: 'executor_primary' as const, alt: 'executor_alternate' as const },
                    { label: 'DPOA Agent', primary: 'poa_primary' as const, alt: 'poa_alternate' as const },
                    { label: 'Healthcare Proxy', primary: 'hcp_primary' as const, alt: 'hcp_alternate' as const },
                  ].map(({ label, primary, alt }) => (
                    <div key={label} style={{ marginBottom: 12 }}>
                      <FieldLabel>{label}</FieldLabel>
                      <Row2>
                        <Field>
                          <ContactCombobox
                            value={str(primary)}
                            onChange={(v) => set(primary, v)}
                            suggestions={intakeContacts}
                            placeholder="Primary (name)"
                          />
                        </Field>
                        <Field>
                          <ContactCombobox
                            value={str(alt)}
                            onChange={(v) => set(alt, v)}
                            suggestions={intakeContacts}
                            placeholder="Successor / alternate"
                          />
                        </Field>
                      </Row2>
                    </div>
                  ))}

                  {showGuardian && (
                    <div style={{ marginBottom: 12 }}>
                      <FieldLabel>Guardian for minor children</FieldLabel>
                      <Row2>
                        <Field>
                          <ContactCombobox
                            value={str('guardian_primary')}
                            onChange={(v) => set('guardian_primary', v)}
                            suggestions={intakeContacts}
                            placeholder="Primary (name)"
                          />
                        </Field>
                        <Field>
                          <ContactCombobox
                            value={str('guardian_alternate')}
                            onChange={(v) => set('guardian_alternate', v)}
                            suggestions={intakeContacts}
                            placeholder="Successor / alternate"
                          />
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
                      <input style={inputStyle} value={str('pb_decedent_name')} onChange={e => set('pb_decedent_name', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Date of death</FieldLabel>
                      <input style={inputStyle} type="date" value={str('pb_date_of_death')} onChange={e => set('pb_date_of_death', e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>Domicile at death</FieldLabel>
                      <input style={inputStyle} value={str('pb_domicile')} onChange={e => set('pb_domicile', e.target.value)} placeholder="City, State" />
                    </Field>
                    <Field>
                      <FieldLabel>Approx. estate value</FieldLabel>
                      <input style={inputStyle} value={str('pb_estate_value')} onChange={e => set('pb_estate_value', e.target.value)} placeholder="e.g. $450K" />
                    </Field>
                    <Field span2>
                      <FieldLabel>Known assets</FieldLabel>
                      <textarea style={textareaStyle} value={str('pb_known_assets')} onChange={e => set('pb_known_assets', e.target.value)} rows={2} />
                    </Field>
                    <Field span2>
                      <FieldLabel>Known debts / liabilities</FieldLabel>
                      <textarea style={textareaStyle} value={str('pb_known_debts')} onChange={e => set('pb_known_debts', e.target.value)} rows={2} />
                    </Field>
                    <Field>
                      <FieldLabel>Petitioner relationship to decedent</FieldLabel>
                      <input style={inputStyle} value={str('pb_petitioner_relationship')} onChange={e => set('pb_petitioner_relationship', e.target.value)} placeholder="e.g. spouse, child" />
                    </Field>
                  </Row2>
                  <div style={{ marginTop: 8 }}>
                    <FieldLabel>Goals / timeline notes</FieldLabel>
                    <textarea style={textareaStyle} value={str('pb_goals_timeline')} onChange={e => set('pb_goals_timeline', e.target.value)} rows={3} />
                  </div>
                </>
              )}

              {/* ── Section: Notes ── */}
              <AdminIntakeUploadsList intakeId={currentIntakeId} />

              <GroupLabel>Internal Notes</GroupLabel>
              <textarea
                style={textareaStyle}
                value={str('special_notes')}
                onChange={e => set('special_notes', e.target.value)}
                placeholder="Notes from the consultation — anything not captured above."
                rows={4}
              />
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={footerStyle}>
          {/* Unsaved changes guard */}
          {showDiscard ? (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 10 }}>
                You have unsaved changes. Discard them?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={btnDanger} onClick={doClose}>Discard</button>
                <button type="button" style={btnSecondary} onClick={() => setShowDiscard(false)}>Keep editing</button>
              </div>
            </div>
          ) : (
            <>
              {footerError && (
                <div style={{ fontSize: 12, color: 'var(--destructive)', marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                  {footerError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" style={btnSecondary} onClick={requestClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  style={isDirty && !saving ? btnSecondary : btnSecondaryDisabled}
                  disabled={!isDirty || saving}
                  onClick={handleSaveDraft}
                >
                  {saving ? 'Saving…' : clientLocked ? 'Save attorney edits' : 'Save draft'}
                </button>
                {/* A locked (submitted/approved) intake is edited in place via
                    "Save attorney edits" — never re-submitted, which would
                    re-stamp completion / re-advance the matter. */}
                {!clientLocked && (
                  <button
                    type="button"
                    style={submitting ? { ...btnPrimary, opacity: 0.6, cursor: 'not-allowed' } : btnPrimary}
                    disabled={submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? 'Submitting…' : 'Submit intake'}
                  </button>
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
    trustee_alternate: fid.trustee_alternate ?? '',
    executor_primary: fid.executor_primary ?? '',
    executor_alternate: fid.executor_alternate ?? '',
    poa_primary: fid.poa_primary ?? '',
    poa_alternate: fid.poa_alternate ?? '',
    hcp_primary: fid.hcp_primary ?? '',
    hcp_alternate: fid.hcp_alternate ?? '',
    guardian_primary: fid.guardian_primary ?? '',
    guardian_alternate: fid.guardian_alternate ?? '',
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
