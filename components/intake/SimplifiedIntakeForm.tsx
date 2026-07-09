'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AuthTokenProvider, useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { cn } from '@/lib/utils'
import { getFirmConfig } from '@/lib/firmConfig'

const firm = getFirmConfig()

const STEPS = [
  { id: 'personal', label: 'Personal' },
  { id: 'family', label: 'Family' },
  { id: 'fiduciaries', label: 'Fiduciaries' },
  { id: 'review', label: 'Review' },
] as const

type StepId = (typeof STEPS)[number]['id']

type ChildRow = {
  contact_id?: string | null
  first_name: string
  last_name: string
  middle_name?: string
  date_of_birth?: string
}

type FormState = {
  first_name: string
  middle_name: string
  last_name: string
  preferred_name: string
  date_of_birth: string
  phone: string
  email: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
  county: string
  marital_status: string
  has_children: boolean | null
  spouse_first_name: string
  spouse_last_name: string
  spouse_middle_name: string
  spouse_date_of_birth: string
  spouse_email: string
  spouse_phone: string
  children: ChildRow[]
  fiduciaries: {
    personal_representative: string
    successor_trustee: string
    healthcare_proxy: string
    power_of_attorney: string
  }
  special_notes: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function buildInitial(data: Record<string, unknown>): FormState {
  const childrenRaw = Array.isArray(data.children) ? data.children : []
  const fiduciaries =
    data.fiduciaries && typeof data.fiduciaries === 'object'
      ? (data.fiduciaries as Record<string, unknown>)
      : {}

  return {
    first_name: str(data.first_name),
    middle_name: str(data.middle_name),
    last_name: str(data.last_name),
    preferred_name: str(data.preferred_name),
    date_of_birth: str(data.date_of_birth),
    phone: str(data.phone),
    email: str(data.email),
    address_line1: str(data.address_line1),
    address_line2: str(data.address_line2),
    city: str(data.city),
    state: str(data.state) || 'MA',
    zip: str(data.zip),
    county: str(data.county),
    marital_status: str(data.marital_status),
    has_children: typeof data.has_children === 'boolean' ? data.has_children : null,
    spouse_first_name: str(data.spouse_first_name),
    spouse_last_name: str(data.spouse_last_name),
    spouse_middle_name: str(data.spouse_middle_name),
    spouse_date_of_birth: str(data.spouse_date_of_birth),
    spouse_email: str(data.spouse_email),
    spouse_phone: str(data.spouse_phone),
    children: childrenRaw.map((c) => {
      const row = c as Record<string, unknown>
      if (row.first_name || row.last_name) {
        return {
          contact_id: typeof row.contact_id === 'string' ? row.contact_id : null,
          first_name: str(row.first_name),
          last_name: str(row.last_name),
          middle_name: str(row.middle_name),
          date_of_birth: str(row.date_of_birth ?? row.dob),
        }
      }
      const split = splitName(str(row.name))
      return {
        contact_id: typeof row.contact_id === 'string' ? row.contact_id : null,
        first_name: split.first,
        last_name: split.last,
        middle_name: '',
        date_of_birth: str(row.dob ?? row.date_of_birth),
      }
    }),
    fiduciaries: {
      personal_representative: str(fiduciaries.personal_representative),
      successor_trustee: str(fiduciaries.successor_trustee),
      healthcare_proxy: str(fiduciaries.healthcare_proxy),
      power_of_attorney: str(fiduciaries.power_of_attorney),
    },
    special_notes: str(data.special_notes),
  }
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function SimplifiedIntakeFormInner({
  initialData,
  intakeId,
}: {
  initialData: Record<string, unknown>
  intakeId: string
}) {
  const router = useRouter()
  const token = useAccessToken()
  const [step, setStep] = useState<StepId>('personal')
  const [form, setForm] = useState<FormState>(() => buildInitial(initialData))
  const [saving, setSaving] = useState(false)

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const buildPayload = useCallback(
    (status: 'draft' | 'submitted') => {
      const fullName = [form.first_name, form.middle_name, form.last_name]
        .filter(Boolean)
        .join(' ')
      return {
        existingId: intakeId,
        status,
        current_step: step,
        first_name: form.first_name,
        middle_name: form.middle_name || null,
        last_name: form.last_name,
        preferred_name: form.preferred_name || null,
        full_name: fullName || null,
        date_of_birth: form.date_of_birth || null,
        phone: form.phone || null,
        email: form.email || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        county: form.county || null,
        marital_status: form.marital_status || null,
        has_minor_children: form.has_children,
        marriage_date: null,
        spouse_first_name: form.spouse_first_name || null,
        spouse_last_name: form.spouse_last_name || null,
        spouse_middle_name: form.spouse_middle_name || null,
        spouse_date_of_birth: form.spouse_date_of_birth || null,
        spouse_email: form.spouse_email || null,
        spouse_phone: form.spouse_phone || null,
        children: form.children.filter((c) => c.first_name.trim() || c.last_name.trim()),
        fiduciaries: form.fiduciaries,
        notes: form.special_notes || null,
        special_notes: form.special_notes || null,
      }
    },
    [form, intakeId, step],
  )

  async function save(status: 'draft' | 'submitted') {
    if (!token) {
      toast.error('Please sign in again to save.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildPayload(status)),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? 'Save failed')
      }
      if (status === 'submitted') {
        toast.success('Intake submitted')
        router.push('/dashboard')
        router.refresh()
      } else {
        toast.success('Progress saved')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save intake')
    } finally {
      setSaving(false)
    }
  }

  function goNext() {
    void save('draft')
    if (stepIndex < STEPS.length - 1) {
      setStep(STEPS[stepIndex + 1].id)
    }
  }

  function goBack() {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1].id)
  }

  const married =
    form.marital_status === 'married' ||
    form.marital_status === 'Married' ||
    form.marital_status.toLowerCase().includes('married')

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {firm.firmName}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Intake questionnaire</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about yourself, your family, and who should serve in key roles.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              step === s.id
                ? 'bg-primary text-primary-foreground'
                : i < stepIndex
                  ? 'bg-muted text-foreground'
                  : 'bg-muted/50 text-muted-foreground',
            )}
          >
            {i + 1}. {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        {step === 'personal' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                <Input value={form.first_name} onChange={(e) => update('first_name', e.target.value)} />
              </Field>
              <Field label="Last name">
                <Input value={form.last_name} onChange={(e) => update('last_name', e.target.value)} />
              </Field>
              <Field label="Middle name">
                <Input value={form.middle_name} onChange={(e) => update('middle_name', e.target.value)} />
              </Field>
              <Field label="Preferred name">
                <Input value={form.preferred_name} onChange={(e) => update('preferred_name', e.target.value)} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.date_of_birth} onChange={(e) => update('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => update('phone', e.target.value)} />
              </Field>
              <Field label="Email" className="sm:col-span-2">
                <Input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Input value={form.address_line1} onChange={(e) => update('address_line1', e.target.value)} />
              </Field>
              <Field label="Address line 2" className="sm:col-span-2">
                <Input value={form.address_line2} onChange={(e) => update('address_line2', e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => update('city', e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={form.state} onChange={(e) => update('state', e.target.value)} />
              </Field>
              <Field label="ZIP">
                <Input value={form.zip} onChange={(e) => update('zip', e.target.value)} />
              </Field>
              <Field label="County">
                <Input value={form.county} onChange={(e) => update('county', e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {step === 'family' && (
          <>
            <Field label="Marital status">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.marital_status}
                onChange={(e) => update('marital_status', e.target.value)}
              >
                <option value="">Select…</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
                <option value="domestic_partner">Domestic partner</option>
              </select>
            </Field>

            {married && (
              <div className="grid gap-4 rounded-md border border-border/60 p-4 sm:grid-cols-2">
                <p className="sm:col-span-2 text-sm font-medium text-foreground">Spouse</p>
                <Field label="Spouse first name">
                  <Input
                    value={form.spouse_first_name}
                    onChange={(e) => update('spouse_first_name', e.target.value)}
                  />
                </Field>
                <Field label="Spouse last name">
                  <Input
                    value={form.spouse_last_name}
                    onChange={(e) => update('spouse_last_name', e.target.value)}
                  />
                </Field>
                <Field label="Spouse date of birth">
                  <Input
                    type="date"
                    value={form.spouse_date_of_birth}
                    onChange={(e) => update('spouse_date_of_birth', e.target.value)}
                  />
                </Field>
                <Field label="Spouse email">
                  <Input
                    type="email"
                    value={form.spouse_email}
                    onChange={(e) => update('spouse_email', e.target.value)}
                  />
                </Field>
                <Field label="Spouse phone" className="sm:col-span-2">
                  <Input
                    value={form.spouse_phone}
                    onChange={(e) => update('spouse_phone', e.target.value)}
                  />
                </Field>
              </div>
            )}

            <Field label="Do you have children?">
              <div className="flex gap-2">
                {[true, false].map((val) => (
                  <Button
                    key={String(val)}
                    type="button"
                    size="sm"
                    variant={form.has_children === val ? 'default' : 'outline'}
                    onClick={() => update('has_children', val)}
                  >
                    {val ? 'Yes' : 'No'}
                  </Button>
                ))}
              </div>
            </Field>

            {form.has_children && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Children</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      update('children', [
                        ...form.children,
                        { first_name: '', last_name: '', middle_name: '', date_of_birth: '' },
                      ])
                    }
                  >
                    Add child
                  </Button>
                </div>
                {form.children.map((child, idx) => (
                  <div key={idx} className="grid gap-3 rounded-md border border-border/60 p-3 sm:grid-cols-3">
                    <Field label="First name">
                      <Input
                        value={child.first_name}
                        onChange={(e) => {
                          const next = [...form.children]
                          next[idx] = { ...child, first_name: e.target.value }
                          update('children', next)
                        }}
                      />
                    </Field>
                    <Field label="Last name">
                      <Input
                        value={child.last_name}
                        onChange={(e) => {
                          const next = [...form.children]
                          next[idx] = { ...child, last_name: e.target.value }
                          update('children', next)
                        }}
                      />
                    </Field>
                    <Field label="Date of birth">
                      <Input
                        type="date"
                        value={child.date_of_birth ?? ''}
                        onChange={(e) => {
                          const next = [...form.children]
                          next[idx] = { ...child, date_of_birth: e.target.value }
                          update('children', next)
                        }}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {step === 'fiduciaries' && (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Enter the full name of each person you would like to nominate. You can refine details with the firm later.
            </p>
            {(
              [
                ['personal_representative', 'Personal representative / executor'],
                ['successor_trustee', 'Successor trustee'],
                ['healthcare_proxy', 'Healthcare proxy'],
                ['power_of_attorney', 'Power of attorney'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  value={form.fiduciaries[key]}
                  onChange={(e) =>
                    update('fiduciaries', { ...form.fiduciaries, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
            <Field label="Anything else we should know?">
              <Textarea
                rows={4}
                value={form.special_notes}
                onChange={(e) => update('special_notes', e.target.value)}
              />
            </Field>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-foreground">Review before submitting</p>
            <dl className="space-y-2 text-muted-foreground">
              <div>
                <dt className="text-xs uppercase tracking-wide">Name</dt>
                <dd className="text-foreground">
                  {[form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide">Contact</dt>
                <dd className="text-foreground">
                  {[form.email, form.phone].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide">Address</dt>
                <dd className="text-foreground">
                  {[form.address_line1, form.city, form.state, form.zip].filter(Boolean).join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide">Family</dt>
                <dd className="text-foreground">
                  {form.marital_status || '—'}
                  {married && form.spouse_first_name
                    ? ` · Spouse: ${form.spouse_first_name} ${form.spouse_last_name}`
                    : ''}
                  {form.has_children
                    ? ` · ${form.children.filter((c) => c.first_name || c.last_name).length} child(ren)`
                    : ''}
                </dd>
              </div>
            </dl>
            <p className="pt-2 text-xs text-muted-foreground">
              Submitting locks this questionnaire. Contact {firm.email} if you need changes afterward.
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={goBack} disabled={stepIndex === 0 || saving}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void save('draft')} disabled={saving}>
            Save draft
          </Button>
          {step === 'review' ? (
            <Button type="button" onClick={() => void save('submitted')} disabled={saving}>
              Submit intake
            </Button>
          ) : (
            <Button type="button" onClick={goNext} disabled={saving}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SimplifiedIntakeForm(props: {
  initialData: Record<string, unknown>
  intakeId: string
}) {
  return (
    <AuthTokenProvider>
      <SimplifiedIntakeFormInner {...props} />
    </AuthTokenProvider>
  )
}
