'use client'

import { useState } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import { formatDobWithAge } from '@/lib/dob'
import { Button } from '@/components/ui/button'
import { IntakeResyncDialog } from '@/components/design-sheet/IntakeResyncDialog'
import { SectionBlock } from './shared'
import type { IntakeSnapshot } from '@/lib/queries'

// ── Read-only field primitives ───────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  )
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = textValue(value)
    return single ? [single] : []
  }

  return value.map(textValue).filter((item): item is string => item !== null)
}

function ReadDobField({ label, value }: { label: string; value?: unknown }) {
  const dob = textValue(value)
  const display = dob ? (formatDobWithAge(dob) ?? dob) : null
  return <ReadField label={label} value={display} />
}

function ReadField({ label, value, empty = '—' }: { label: string; value?: unknown; empty?: string }) {
  const displayValue = textValue(value)

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className={cn('text-[13px]', displayValue ? 'text-foreground' : 'text-muted-foreground/50')}>
        {displayValue || empty}
      </p>
    </div>
  )
}

function BoolField({ label, value }: { label: string; value: unknown }) {
  const displayValue = booleanValue(value)

  return (
    <div className="flex items-center gap-2">
      {displayValue === true && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
      {displayValue === false && <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
      {displayValue === null && <span className="h-3.5 w-3.5 shrink-0" />}
      <span className={cn('text-[13px]', displayValue ? 'text-foreground' : 'text-muted-foreground/50')}>
        {label}
      </span>
    </div>
  )
}

function FiduciaryRow({ role, primary, alternate }: { role: string; primary: unknown; alternate: unknown }) {
  const primaryValue = textValue(primary)
  const alternateValue = textValue(alternate)

  if (!primaryValue && !alternateValue) return null
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{role}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <ReadField label="Primary" value={primaryValue} />
        <ReadField label="Alternate" value={alternateValue} />
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function IntakeSection({
  intake,
  matterId,
}: {
  intake: IntakeSnapshot
  matterId: string
}) {
  const [resyncOpen, setResyncOpen] = useState(false)
  const firstName = textValue(intake.first_name)
  const middleName = textValue(intake.middle_name)
  const lastName = textValue(intake.last_name)
  const suffix = textValue(intake.suffix)
  const spouseFirstName = textValue(intake.spouse_first_name)
  const spouseLastName = textValue(intake.spouse_last_name)
  const children = recordArray(intake.children)
  const planningObjectives = textValue(intake.planning_objectives)
  const specialNotes = textValue(intake.special_notes)
  const specialCircumstances = textArray(intake.special_circumstances)
  const goalsExtended = isRecord(intake.goals_extended) ? intake.goals_extended : null
  const wishesAndConcerns = textValue(goalsExtended?.wishesAndConcerns)
  const specialConsiderations = textValue(goalsExtended?.specialConsiderations)
  const realEstateExtended = recordArray(intake.real_estate_extended)
  const financialAccounts = recordArray(intake.financial_accounts)
  const retirementValue = textValue(intake.retirement_value)
  const lifeInsuranceValue = textValue(intake.life_insurance_value)
  const businessDescription = textValue(intake.business_description)
  const hasRealProperty = booleanValue(intake.has_real_property) === true
  const hasRetirement = booleanValue(intake.has_retirement) === true
  const hasLifeInsurance = booleanValue(intake.has_life_insurance) === true
  const hasBusiness = booleanValue(intake.has_business) === true
  const hasInvestments = booleanValue(intake.has_investments) === true
  const hasSpouse = !!(spouseFirstName || spouseLastName)
  const hasChildren = children.length > 0
  const hasAssets = hasRealProperty || hasRetirement || hasLifeInsurance || hasBusiness || hasInvestments || realEstateExtended.length > 0 || financialAccounts.length > 0
  const hasExistingDocs = [intake.has_will, intake.has_trust, intake.has_poa, intake.has_hcp].some(value => booleanValue(value) === true)
  const hasMinorChildren = booleanValue(intake.has_minor_children) === true
  const hasFiduciaries = [
    intake.trustee_primary,
    intake.executor_primary,
    intake.poa_primary,
    intake.hcp_primary,
    ...(hasMinorChildren ? [intake.guardian_primary] : []),
  ].some(value => textValue(value))
  const hasGoals = !!(planningObjectives || specialNotes || wishesAndConcerns || specialConsiderations || specialCircumstances.length > 0)

  return (
    <div className="space-y-0">
      <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Intake is read-only here</p>
              <p>
                Client intake seeds the design sheet once. After that, only the design sheet feeds
                document templates. Intake updates do not overwrite your design sheet automatically.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setResyncOpen(true)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-sync from intake
          </Button>
        </div>
      </div>

      <IntakeResyncDialog
        open={resyncOpen}
        onOpenChange={setResyncOpen}
        matterId={matterId}
      />

      {/* Personal */}
      <SectionBlock title="Personal Information">
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <ReadField
            label="Full Name"
            value={[firstName, middleName, lastName, suffix].filter(Boolean).join(' ')}
          />
          <ReadDobField label="Date of Birth" value={intake.date_of_birth} />
          <ReadField label="Marital Status" value={intake.marital_status} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <ReadField label="Phone" value={formatPhoneDisplay(intake.phone)} />
          <ReadField label="Email" value={intake.email} />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-x-4 gap-y-4">
          <ReadField label="Street" value={intake.address_line1} />
          <ReadField label="City" value={intake.city} />
          <ReadField label="State" value={intake.state} />
          <ReadField label="ZIP" value={intake.zip} />
        </div>
        {intake.county && (
          <div className="mt-4">
            <ReadField label="County" value={intake.county} />
          </div>
        )}
      </SectionBlock>

      {/* Spouse */}
      {hasSpouse && (
        <SectionBlock title="Spouse / Partner">
          <div className="grid grid-cols-3 gap-x-6 gap-y-4">
            <ReadField
              label="Full Name"
              value={[spouseFirstName, spouseLastName].filter(Boolean).join(' ')}
            />
            <ReadDobField label="Date of Birth" value={intake.spouse_date_of_birth} />
            <ReadField label="Date of Marriage" value={intake.date_of_marriage} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <ReadField label="Phone" value={formatPhoneDisplay(intake.spouse_phone)} />
            <ReadField label="Email" value={intake.spouse_email} />
          </div>
        </SectionBlock>
      )}

      {/* Children */}
      {hasChildren && (
        <SectionBlock title="Children">
          <div className="space-y-3">
            {children.map((child, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="grid grid-cols-3 gap-x-6">
                  <ReadField label="Name" value={child.name} />
                  <ReadDobField label="Date of Birth" value={child.date_of_birth} />
                  <ReadField label="Relationship" value={child.relationship} />
                </div>
              </div>
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Goals & Concerns */}
      {hasGoals && (
        <SectionBlock title="Goals & Concerns">
          {planningObjectives && (
            <div className="mb-4">
              <FieldLabel>Planning Objectives</FieldLabel>
              <p className="whitespace-pre-wrap text-[13px] text-foreground leading-relaxed">
                {planningObjectives}
              </p>
            </div>
          )}
          {wishesAndConcerns && (
            <div className="mb-4">
              <FieldLabel>Wishes & Concerns</FieldLabel>
              <p className="whitespace-pre-wrap text-[13px] text-foreground leading-relaxed">
                {wishesAndConcerns}
              </p>
            </div>
          )}
          {specialCircumstances.length > 0 && (
            <div className="mb-4">
              <FieldLabel>Special Circumstances</FieldLabel>
              <ul className="list-disc list-inside space-y-0.5">
                {specialCircumstances.map((s, i) => (
                  <li key={i} className="text-[13px] text-foreground">{s}</li>
                ))}
              </ul>
            </div>
          )}
          {specialConsiderations && (
            <div className="mb-4">
              <FieldLabel>Special Considerations</FieldLabel>
              <p className="whitespace-pre-wrap text-[13px] text-foreground leading-relaxed">
                {specialConsiderations}
              </p>
            </div>
          )}
          {specialNotes && (
            <div>
              <FieldLabel>Special Notes</FieldLabel>
              <p className="whitespace-pre-wrap text-[13px] text-foreground leading-relaxed">
                {specialNotes}
              </p>
            </div>
          )}
        </SectionBlock>
      )}

      {/* Existing Documents */}
      {hasExistingDocs && (
        <SectionBlock title="Existing Documents">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <BoolField label="Has Will" value={intake.has_will} />
            <BoolField label="Has Trust" value={intake.has_trust} />
            <BoolField label="Has Power of Attorney" value={intake.has_poa} />
            <BoolField label="Has Healthcare Proxy" value={intake.has_hcp} />
          </div>
        </SectionBlock>
      )}

      {/* Assets */}
      {(hasAssets || textValue(intake.estate_value)) && (
        <SectionBlock title="Assets & Estate">
          {textValue(intake.estate_value) && (
            <div className="mb-4">
              <ReadField label="Estimated Estate Value" value={intake.estate_value} />
            </div>
          )}
          <div className="space-y-3">
            {hasRealProperty && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Real Property</p>
                <div className="grid grid-cols-2 gap-x-6">
                  <ReadField label="Address" value={intake.real_property_address} />
                  <ReadField label="Estimated Value" value={intake.real_property_value} />
                </div>
              </div>
            )}
            {realEstateExtended.map((re, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Real Property {i + 1}</p>
                <div className="grid grid-cols-3 gap-x-6">
                  <ReadField label="Address" value={re.address} />
                  <ReadField label="Ownership" value={re.ownership} />
                  <ReadField label="Estimated Value" value={re.estimatedValue} />
                </div>
              </div>
            ))}
            {hasRetirement && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
                <span className="text-[13px] text-foreground">Retirement Accounts</span>
                <span className="text-[13px] text-foreground font-medium">{retirementValue || '—'}</span>
              </div>
            )}
            {hasLifeInsurance && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
                <span className="text-[13px] text-foreground">Life Insurance</span>
                <span className="text-[13px] text-foreground font-medium">{lifeInsuranceValue || '—'}</span>
              </div>
            )}
            {hasBusiness && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Business Interest</p>
                <p className="text-[13px] text-foreground">{businessDescription || '—'}</p>
              </div>
            )}
            {hasInvestments && (
              <div className="flex items-center rounded-lg border border-border bg-muted/40 p-3">
                <Check className="h-3.5 w-3.5 mr-2 text-success" />
                <span className="text-[13px] text-foreground">Investment accounts / taxable brokerage</span>
              </div>
            )}
            {financialAccounts.map((fa, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="grid grid-cols-3 gap-x-6">
                  <ReadField label="Institution" value={fa.institution} />
                  <ReadField label="Account Type" value={fa.accountType} />
                  <ReadField label="Approx. Value" value={fa.approximateValue} />
                </div>
              </div>
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Fiduciaries */}
      {hasFiduciaries && (
        <SectionBlock title="Fiduciary Choices">
          <div className="space-y-3">
            <FiduciaryRow role="Trustee" primary={intake.trustee_primary} alternate={intake.trustee_alternate} />
            <FiduciaryRow role="Executor / Personal Representative" primary={intake.executor_primary} alternate={intake.executor_alternate} />
            <FiduciaryRow role="Financial Power of Attorney" primary={intake.poa_primary} alternate={intake.poa_alternate} />
            <FiduciaryRow role="Healthcare Proxy" primary={intake.hcp_primary} alternate={intake.hcp_alternate} />
            {hasMinorChildren && (
              <FiduciaryRow role="Guardian" primary={intake.guardian_primary} alternate={intake.guardian_alternate} />
            )}
          </div>
        </SectionBlock>
      )}

    </div>
  )
}
