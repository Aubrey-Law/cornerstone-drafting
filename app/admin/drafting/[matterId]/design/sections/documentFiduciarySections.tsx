'use client'

import { cn } from '@/lib/utils'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { SectionProps } from './shared'
import { AttorneySelect, FieldLabel, SectionBlock } from './shared'
import {
  cloneSlots,
  findClientContact,
  findSpouseContact,
  FiduciaryBlock,
  isMarriedSheet,
} from './fiduciary-blocks'
import { ExcludedGuardians } from './ExcludedGuardiansSection'

export interface DocumentFiduciaryProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

function useFiduciaryContext(props: DocumentFiduciaryProps) {
  const { sheet, contacts, matter } = props
  const inclusions = getDocumentInclusions(sheet)
  const married = isMarriedSheet(sheet)
  const spouseDocs = married && inclusions.spouse_docs
  const separateTrusts = married && sheet.is_joint === false
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = married ? findSpouseContact(contacts, matter, sheet) : null
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseTrusteeSource = separateTrusts ? sheet.spouse_trustee_slots : sheet.trustee_slots
  const hasMinorChildren = sheetHasMinorChildren(sheet.children)
  const blockProps = { ...props, contacts, matter }

  return {
    inclusions,
    spouseDocs,
    separateTrusts,
    clientContact,
    spouseContact,
    clientFirst,
    spouseFirst,
    spouseTrusteeSource,
    hasMinorChildren,
    blockProps,
  }
}

export function TrustFiduciarySections(props: DocumentFiduciaryProps & { scope?: 'client' | 'spouse'; trusteesOnly?: boolean }) {
  const { sheet, onChange, scope = 'client', trusteesOnly = false } = props
  const {
    inclusions,
    separateTrusts,
    clientContact,
    spouseContact,
    clientFirst,
    spouseFirst,
    blockProps,
  } = useFiduciaryContext(props)

  if (!inclusions.trust) return null

  if (scope === 'spouse') {
    if (!separateTrusts) return null
    return (
      <FiduciaryBlock
        {...blockProps}
        role="trustee"
        slotField="spouse_trustee_slots"
        sectionTitle={`${spouseFirst || 'Spouse'}'s Successor Trustees`}
        coShortcutContact={null}
      />
    )
  }

  return (
    <>
      {!trusteesOnly && (
      <SectionBlock title="Trustee Nomination Structure" subtitle="Drives how trustee slots are nominated in the trust">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <AttorneySelect
            label="Trustee Nomination Structure"
            value={sheet.trustee_structure ?? ''}
            placeholder="Select…"
            options={[
              { value: 'single', label: 'Single trustee + successor' },
              { value: 'spouse_first', label: 'Spouse first, then successor' },
              { value: 'co_trustees', label: 'Co-trustees' },
            ]}
            onChange={v => onChange('trustee_structure', (v || null) as 'single' | 'spouse_first' | 'co_trustees' | null)}
          />
        </div>
        {sheet.trustee_structure === 'co_trustees' && (
          <div className="mt-4 max-w-[320px]">
            <FieldLabel>Co-Trustee Decision Standard</FieldLabel>
            <div className={cn('flex gap-0.5 rounded-lg bg-muted p-[2px]')}>
              {[
                { value: 'majority', label: 'Majority (3+)' },
                { value: 'unanimous', label: 'Unanimous' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange('cotrustee_decision_standard', opt.value as 'majority' | 'unanimous')}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
                    (sheet.cotrustee_decision_standard ?? 'majority') === opt.value
                      ? 'bg-card font-semibold text-primary shadow-sm'
                      : 'text-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </SectionBlock>
      )}

      <FiduciaryBlock
        {...blockProps}
        role="trustee"
        sectionTitle={
          sheet.is_joint
            ? 'Successor Trustees'
            : separateTrusts
              ? `${clientFirst || 'Client'}'s Successor Trustees`
              : `${clientFirst || 'Client'}'s Successor Trustees`
        }
        clientShortcutContact={null}
      />
    </>
  )
}

export function WillFiduciarySections(props: DocumentFiduciaryProps) {
  const { sheet, onChange } = props
  const {
    inclusions,
    spouseDocs,
    clientContact,
    spouseContact,
    clientFirst,
    spouseFirst,
    spouseTrusteeSource,
    hasMinorChildren,
    blockProps,
  } = useFiduciaryContext(props)

  if (!inclusions.will) return null

  return (
    <>
      <SectionBlock title="Personal Representative Structure" subtitle="Drives how PR slots are nominated in the will">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <AttorneySelect
            label="Personal Representative Structure"
            value={sheet.pr_structure ?? ''}
            placeholder="Select…"
            options={[
              { value: 'single', label: 'Single PR + successor' },
              { value: 'spouse_first', label: 'Spouse first, then successor' },
              { value: 'co_pr', label: 'Co-PRs serving jointly' },
            ]}
            onChange={v => onChange('pr_structure', (v || null) as 'single' | 'spouse_first' | 'co_pr' | null)}
          />
        </div>
      </SectionBlock>

      <FiduciaryBlock
        {...blockProps}
        role="executor"
        sectionTitle={`${clientFirst || 'Client'}'s Personal Representative`}
        sameAsTrustee={sheet.executor_same_as_trustee}
        onSameAsTrusteeToggle={() => {
          const next = !sheet.executor_same_as_trustee
          onChange('executor_same_as_trustee', next)
          if (next) onChange('executor_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['executor_slots'])
        }}
        primaryShortcutContact={spouseContact}
        primaryShortcutLabel={spouseContact ? `${spouseFirst || 'Spouse'} as primary personal representative` : undefined}
      />

      {spouseDocs && (
        <FiduciaryBlock
          {...blockProps}
          role="executor"
          slotField="spouse_executor_slots"
          sectionTitle={`${spouseFirst || 'Spouse'}'s Personal Representative`}
          sameAsTrustee={sheet.spouse_executor_same_as_trustee}
          sameAsTrusteeLabel="Same as Spouse's Trustees"
          onSameAsTrusteeToggle={() => {
            const next = !sheet.spouse_executor_same_as_trustee
            onChange('spouse_executor_same_as_trustee', next)
            if (next) {
              onChange('spouse_executor_slots', cloneSlots(spouseTrusteeSource) as DesignSheet['spouse_executor_slots'])
            }
          }}
          primaryShortcutContact={clientContact}
          primaryShortcutLabel={clientContact ? `${clientFirst || 'Client'} as primary personal representative` : undefined}
        />
      )}

      {hasMinorChildren && (
        <>
          <FiduciaryBlock
            {...blockProps}
            role="guardian"
            spouseOptionLabel={spouseContact ? 'Spouse as guardian' : undefined}
          />
          <ExcludedGuardians {...props} />
          <FiduciaryBlock
            {...blockProps}
            role="temporary_guardian"
            spouseOptionLabel={spouseContact ? 'Spouse as temporary guardian' : undefined}
          />
        </>
      )}
    </>
  )
}

export function DpoaFiduciarySections(props: DocumentFiduciaryProps) {
  const { sheet, onChange } = props
  const { inclusions, spouseDocs, clientContact, spouseContact, clientFirst, spouseFirst, blockProps } = useFiduciaryContext(props)

  if (!inclusions.dpoa) return null

  return (
    <>
      <FiduciaryBlock
        {...blockProps}
        role="poa"
        slotScope="primary"
        sectionTitle={`${clientFirst || 'Client'}'s First Attorney-in-Fact(s)`}
        primaryLabel="First Attorney-in-Fact"
        coLabel="Co-Agent"
        sameAsTrustee={sheet.poa_same_as_trustee}
        onSameAsTrusteeToggle={() => {
          const next = !sheet.poa_same_as_trustee
          onChange('poa_same_as_trustee', next)
          if (next) onChange('poa_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['poa_slots'])
        }}
        spouseOptionLabel={spouseContact ? 'Spouse as DPOA agent' : undefined}
      />
      <FiduciaryBlock
        {...blockProps}
        role="poa"
        slotScope="backup"
        sectionTitle="Backup Attorney-in-fact(s)"
        primaryLabel="Backup Attorney-in-Fact"
        altLabel="Backup Attorney-in-Fact"
      />

      {spouseDocs && (
        <>
          <FiduciaryBlock
            {...blockProps}
            role="poa"
            slotField="spouse_poa_slots"
            slotScope="primary"
            sectionTitle={`${spouseFirst || 'Spouse'}'s First Attorney-in-Fact(s)`}
            primaryLabel="First Attorney-in-Fact"
            coLabel="Co-Agent"
            sameAsTrustee={sheet.spouse_poa_same_as_trustee}
            sameAsTrusteeLabel="Same as Spouse's Trustees"
            onSameAsTrusteeToggle={() => {
              const next = !sheet.spouse_poa_same_as_trustee
              onChange('spouse_poa_same_as_trustee', next)
              if (next) {
                onChange('spouse_poa_slots', cloneSlots(props.sheet.spouse_trustee_slots) as DesignSheet['spouse_poa_slots'])
              }
            }}
            primaryShortcutContact={clientContact}
            primaryShortcutLabel="Client as spouse / partner DPOA agent"
          />
          <FiduciaryBlock
            {...blockProps}
            role="poa"
            slotField="spouse_poa_slots"
            slotScope="backup"
            sectionTitle="Backup Attorney-in-fact(s)"
            primaryLabel="Backup Attorney-in-Fact"
            altLabel="Backup Attorney-in-Fact"
          />
        </>
      )}
    </>
  )
}

export function HealthCareFiduciarySections(props: DocumentFiduciaryProps) {
  const { spouseDocs, clientContact, spouseContact, blockProps, inclusions } = useFiduciaryContext(props)

  if (!inclusions.healthcare) return null

  return (
    <>
      <FiduciaryBlock
        {...blockProps}
        role="hcp"
        spouseOptionLabel={spouseContact ? 'Spouse as health care agent' : undefined}
      />

      {spouseDocs && (
        <FiduciaryBlock
          {...blockProps}
          role="hcp"
          slotField="spouse_hcp_slots"
          sectionTitle="Spouse / Partner Health Care Proxy"
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner health care agent"
        />
      )}
    </>
  )
}
