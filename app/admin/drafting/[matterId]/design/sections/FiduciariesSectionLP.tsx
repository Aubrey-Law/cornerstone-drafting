'use client'

import { useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import ContactPicker from './ContactPicker'
import type { Contact } from './ContactPicker'
import { isMarriedSheet, partyFullName, PartyTabs } from './fiduciary-blocks'

// ── Types ─────────────────────────────────────────────────────────────────────

type PlanCoverage = 'no_trust' | 'trust_included'

interface HcpSlot { contact: Contact | null; address: string }

interface FiduciarySet {
  pr: { primary: Contact | null; successor: Contact | null; second_successor: Contact | null }
  dpoa: { primary: Contact | null; co_agent: Contact | null; successor: Contact | null }
  hcp: { primary: HcpSlot; successor: HcpSlot }
  trustee: { initial: Contact | null; co_trustee: Contact | null; successor: Contact | null }
  guardian: { primary: Contact | null; successor: Contact | null }
}

interface SpouseFiduciarySet {
  pr: { primary: Contact | null; successor: Contact | null }
  dpoa: { primary: Contact | null; successor: Contact | null }
  hcp: { primary: HcpSlot; successor: HcpSlot }
  trustee: { successor: Contact | null }
}

const EMPTY_HCP: HcpSlot = { contact: null, address: '' }

const EMPTY_CLIENT_FID: FiduciarySet = {
  pr: { primary: null, successor: null, second_successor: null },
  dpoa: { primary: null, co_agent: null, successor: null },
  hcp: { primary: { ...EMPTY_HCP }, successor: { ...EMPTY_HCP } },
  trustee: { initial: null, co_trustee: null, successor: null },
  guardian: { primary: null, successor: null },
}

const EMPTY_SPOUSE_FID: SpouseFiduciarySet = {
  pr: { primary: null, successor: null },
  dpoa: { primary: null, successor: null },
  hcp: { primary: { ...EMPTY_HCP }, successor: { ...EMPTY_HCP } },
  trustee: { successor: null },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FiduciaryBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-gray-800">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-dashed border-gray-200" />
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface LpData {
  li_plan_coverage: string
  li_design_sheet_data: Record<string, unknown>
  li_design_sheet_approved: boolean
}

interface Props {
  lpData: LpData | null
  sheet: DesignSheet
  contacts: MatterContact[]
  onChange: (key: string, value: unknown) => void
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

// ── FiduciariesSectionLP ──────────────────────────────────────────────────────

export function FiduciariesSectionLP({ lpData, sheet, contacts, onChange, matter, onAddContact, onUpdateContact }: Props) {
  const isMarried = isMarriedSheet(sheet) || !!(sheet.spouse_name ?? matter.spouse_name)
  const clientName = partyFullName(sheet, matter, 'client')
  const spouseName = partyFullName(sheet, matter, 'spouse')
  const hasMinorChildren = sheetHasMinorChildren(sheet.children)
  const planCoverage = (lpData?.li_plan_coverage ?? 'no_trust') as PlanCoverage

  const data = lpData?.li_design_sheet_data ?? {}

  const [clientFid, setClientFid] = useState<FiduciarySet>(
    (data.client_fiduciaries as FiduciarySet) ?? { ...EMPTY_CLIENT_FID }
  )
  const [spouseFid, setSpouseFid] = useState<SpouseFiduciarySet>(
    (data.spouse_fiduciaries as SpouseFiduciarySet) ?? { ...EMPTY_SPOUSE_FID }
  )
  const [activeTab, setActiveTab] = useState<'client' | 'spouse'>('client')

  // Helpers that update local state and bubble up to shell
  const updateClientFid = useCallback((updater: (prev: FiduciarySet) => FiduciarySet) => {
    setClientFid(prev => {
      const next = updater(prev)
      onChange('client_fiduciaries', next)
      return next
    })
  }, [onChange])

  const updateSpouseFid = useCallback((updater: (prev: SpouseFiduciarySet) => SpouseFiduciarySet) => {
    setSpouseFid(prev => {
      const next = updater(prev)
      onChange('spouse_fiduciaries', next)
      return next
    })
  }, [onChange])

  // onAddContact bridges MatterContact ↔ Contact (structurally identical)
  const handleAddContact = useCallback(async (data: Omit<Contact, 'id'>): Promise<Contact> => {
    const contact = await onAddContact(data as Omit<MatterContact, 'id'>)
    return contact as Contact
  }, [onAddContact])

  const handleUpdateContact = useCallback(async (id: string, data: Omit<Contact, 'id'>): Promise<Contact> => {
    if (!onUpdateContact) throw new Error('Contact updates are not available here')
    const contact = await onUpdateContact(id, data as Omit<MatterContact, 'id'>)
    return contact as Contact
  }, [onUpdateContact])

  return (
    <div className="space-y-6">
      {isMarried && (
        <PartyTabs
          value={activeTab}
          onChange={setActiveTab}
          clientLabel={clientName}
          spouseLabel={spouseName}
        />
      )}

      {activeTab === 'client' ? (
        <div className="space-y-4">
          {/* PR */}
          <FiduciaryBlock title="Personal Representative (Will)">
            <ContactPicker
              role="PR — Primary (Client)"
              required
              value={clientFid.pr.primary}
              onChange={c => updateClientFid(f => ({ ...f, pr: { ...f.pr, primary: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Divider />
            <ContactPicker
              role="PR — Successor"
              required
              value={clientFid.pr.successor}
              onChange={c => updateClientFid(f => ({ ...f, pr: { ...f.pr, successor: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Divider />
            <ContactPicker
              role="PR — Second Successor"
              value={clientFid.pr.second_successor}
              onChange={c => updateClientFid(f => ({ ...f, pr: { ...f.pr, second_successor: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
          </FiduciaryBlock>

          {/* DPOA */}
          <FiduciaryBlock title="Financial Agent (DPOA)">
            <ContactPicker
              role="DPOA — Primary"
              required
              value={clientFid.dpoa.primary}
              onChange={c => updateClientFid(f => ({ ...f, dpoa: { ...f.dpoa, primary: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Divider />
            <ContactPicker
              role="DPOA — Co-agent"
              value={clientFid.dpoa.co_agent}
              onChange={c => updateClientFid(f => ({ ...f, dpoa: { ...f.dpoa, co_agent: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Divider />
            <ContactPicker
              role="DPOA — Successor"
              required
              value={clientFid.dpoa.successor}
              onChange={c => updateClientFid(f => ({ ...f, dpoa: { ...f.dpoa, successor: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
          </FiduciaryBlock>

          {/* HCP */}
          <FiduciaryBlock title="Health Care Agent (HCP · Advance Directive)">
            <ContactPicker
              role="HCP — Primary"
              required
              value={clientFid.hcp.primary.contact}
              onChange={c => updateClientFid(f => ({ ...f, hcp: { ...f.hcp, primary: { ...f.hcp.primary, contact: c } } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Input
              placeholder="Address"
              value={clientFid.hcp.primary.address}
              onChange={e => updateClientFid(f => ({ ...f, hcp: { ...f.hcp, primary: { ...f.hcp.primary, address: e.target.value } } }))}
              className="mt-2"
            />
            <Divider />
            <ContactPicker
              role="HCP — Successor"
              required
              value={clientFid.hcp.successor.contact}
              onChange={c => updateClientFid(f => ({ ...f, hcp: { ...f.hcp, successor: { ...f.hcp.successor, contact: c } } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Input
              placeholder="Address"
              value={clientFid.hcp.successor.address}
              onChange={e => updateClientFid(f => ({ ...f, hcp: { ...f.hcp, successor: { ...f.hcp.successor, address: e.target.value } } }))}
              className="mt-2"
            />
          </FiduciaryBlock>

          {/* Trustee — trust_included only */}
          {planCoverage === 'trust_included' && (
            <FiduciaryBlock title="Trustee (Revocable Living Trust)">
              <ContactPicker
                role="Initial Trustee"
                required
                value={clientFid.trustee.initial}
                onChange={c => updateClientFid(f => ({ ...f, trustee: { ...f.trustee, initial: c } }))}
                contacts={contacts as Contact[]}
                onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
              />
              <Divider />
              <ContactPicker
                role="Co-Trustee"
                value={clientFid.trustee.co_trustee}
                onChange={c => updateClientFid(f => ({ ...f, trustee: { ...f.trustee, co_trustee: c } }))}
                contacts={contacts as Contact[]}
                onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
              />
              <Divider />
              <ContactPicker
                role="Successor Trustee"
                required
                value={clientFid.trustee.successor}
                onChange={c => updateClientFid(f => ({ ...f, trustee: { ...f.trustee, successor: c } }))}
                contacts={contacts as Contact[]}
                onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
              />
            </FiduciaryBlock>
          )}

          {/* Guardian — minor children only */}
          {hasMinorChildren && (
            <FiduciaryBlock title="Guardian of Minor Children (Will · Parental Appointment)">
              <ContactPicker
                role="Primary Guardian"
                required
                value={clientFid.guardian.primary}
                onChange={c => updateClientFid(f => ({ ...f, guardian: { ...f.guardian, primary: c } }))}
                contacts={contacts as Contact[]}
                onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
              />
              <Divider />
              <ContactPicker
                role="Successor Guardian"
                required
                value={clientFid.guardian.successor}
                onChange={c => updateClientFid(f => ({ ...f, guardian: { ...f.guardian, successor: c } }))}
                contacts={contacts as Contact[]}
                onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
              />
            </FiduciaryBlock>
          )}
        </div>
      ) : (
        /* Spouse tab */
        <div className="space-y-4">
          <FiduciaryBlock title="Personal Representative (Will)">
            <ContactPicker
              role="PR — Primary (Spouse)"
              required
              value={spouseFid.pr.primary}
              onChange={c => updateSpouseFid(f => ({ ...f, pr: { ...f.pr, primary: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Divider />
            <ContactPicker
              role="PR — Successor"
              required
              value={spouseFid.pr.successor}
              onChange={c => updateSpouseFid(f => ({ ...f, pr: { ...f.pr, successor: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
          </FiduciaryBlock>

          <FiduciaryBlock title="Financial Agent (DPOA)">
            <ContactPicker
              role="DPOA — Primary"
              required
              value={spouseFid.dpoa.primary}
              onChange={c => updateSpouseFid(f => ({ ...f, dpoa: { ...f.dpoa, primary: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Divider />
            <ContactPicker
              role="DPOA — Successor"
              required
              value={spouseFid.dpoa.successor}
              onChange={c => updateSpouseFid(f => ({ ...f, dpoa: { ...f.dpoa, successor: c } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
          </FiduciaryBlock>

          <FiduciaryBlock title="Health Care Agent (HCP)">
            <ContactPicker
              role="HCP — Primary"
              required
              value={spouseFid.hcp.primary.contact}
              onChange={c => updateSpouseFid(f => ({ ...f, hcp: { ...f.hcp, primary: { ...f.hcp.primary, contact: c } } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Input
              placeholder="Address"
              value={spouseFid.hcp.primary.address}
              onChange={e => updateSpouseFid(f => ({ ...f, hcp: { ...f.hcp, primary: { ...f.hcp.primary, address: e.target.value } } }))}
              className="mt-2"
            />
            <Divider />
            <ContactPicker
              role="HCP — Successor"
              required
              value={spouseFid.hcp.successor.contact}
              onChange={c => updateSpouseFid(f => ({ ...f, hcp: { ...f.hcp, successor: { ...f.hcp.successor, contact: c } } }))}
              contacts={contacts as Contact[]}
              onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
            />
            <Input
              placeholder="Address"
              value={spouseFid.hcp.successor.address}
              onChange={e => updateSpouseFid(f => ({ ...f, hcp: { ...f.hcp, successor: { ...f.hcp.successor, address: e.target.value } } }))}
              className="mt-2"
            />
          </FiduciaryBlock>

          {planCoverage === 'trust_included' && (
            <FiduciaryBlock title="Trustee — Successor Only">
              <ContactPicker
                role="Successor Trustee"
                required
                value={spouseFid.trustee.successor}
                onChange={c => updateSpouseFid(f => ({ ...f, trustee: { ...f.trustee, successor: c } }))}
                contacts={contacts as Contact[]}
                onAddContact={handleAddContact}
              onUpdateContact={onUpdateContact ? handleUpdateContact : undefined}
              />
            </FiduciaryBlock>
          )}
        </div>
      )}
    </div>
  )
}
