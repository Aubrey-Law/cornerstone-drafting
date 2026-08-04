import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('design sheet spouse fiduciary selections', () => {
  it('stores spouse-specific fiduciary slot arrays on the design sheet', () => {
    const types = fs.readFileSync(path.join(process.cwd(), 'types/database.ts'), 'utf8')
    const initial = fs.readFileSync(path.join(process.cwd(), 'lib/designSheet/buildInitialSheet.ts'), 'utf8')

    expect(types).toContain('spouse_trustee_slots: FiduciarySlot[]')
    expect(types).toContain('spouse_executor_slots: FiduciarySlot[]')
    expect(types).toContain('spouse_poa_slots: FiduciarySlot[]')
    expect(types).toContain('spouse_hcp_slots: FiduciarySlot[]')
    expect(initial).toContain('spouse_trustee_slots: [{ id: crypto.randomUUID(), contact_id: null, is_co: false, order: 0 }]')
    expect(initial).toContain('spouse_executor_slots: [{ id: crypto.randomUUID(), contact_id: null, is_co: false, order: 0 }]')
    expect(initial).toContain('spouse_poa_slots: [{ id: crypto.randomUUID(), contact_id: null, is_co: false, order: 0 }]')
    expect(initial).toContain('spouse_hcp_slots: [{ id: crypto.randomUUID(), contact_id: null, is_co: false, order: 0 }]')
  })

  it('renders spouse fiduciary assignments in the unified grid for married matters', () => {
    const grid = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FiduciaryGrid.tsx'), 'utf8')
    const documentSections = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx'), 'utf8')
    const healthCare = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/HealthCareDesignSection.tsx'), 'utf8')
    const trustDetails = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'), 'utf8')
    const blocks = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/fiduciary-blocks.tsx'), 'utf8')

    expect(grid).toContain('spouseSlotFields')
    expect(grid).toContain('PartyTabs')
    expect(grid).toContain('Mirror reversed')
    expect(grid).toContain('mirrorReversedFiduciarySlots')
    expect(documentSections).not.toContain('<FiduciaryBlock')
    expect(documentSections).not.toContain('<ContactPicker')
    expect(blocks).toContain('CLIENT_PRIMARY_CONTACT_ID')
    expect(blocks).toContain('SPOUSE_PRIMARY_CONTACT_ID')
    expect(blocks).toContain('CLIENT_SLOT_FIELDS')
    expect(blocks).toContain('SPOUSE_SLOT_FIELDS')
    expect(trustDetails).not.toContain("'trustee_slots',")
    expect(trustDetails).not.toContain("'spouse_trustee_slots',")
    expect(healthCare).toContain("party: 'client' | 'spouse'")
    expect(healthCare).not.toContain('<FiduciaryBlock')
    expect(healthCare).toContain("Additional HIPAA Agents")
  })

  it('includes spouse fiduciaries in readiness and drafting payload paths', () => {
    const readiness = fs.readFileSync(path.join(process.cwd(), 'lib/designSheetReadiness.ts'), 'utf8')
    const payload = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/helpers.ts'), 'utf8')

    expect(readiness).toContain('spouseFiduciariesNeeded')
    expect(readiness).toContain("'spouse trustee'")
    expect(readiness).toContain("'spouse personal representative'")
    expect(readiness).toContain("'spouse first attorney-in-fact'")
    expect(readiness).toContain("'spouse first health care agent'")
    expect(payload).toContain('overlayDesignSheetFiduciarySlots')
    expect(payload).toContain("getDesignSlots(designSheet, 'spouse_executor_slots')")
    expect(payload).toContain("getDesignSlots(designSheet, 'spouse_poa_slots')")
    expect(payload).toContain("getDesignSlots(designSheet, 'spouse_hcp_slots')")
    expect(payload).toContain("getDesignSlots(designSheet, 'spouse_trustee_slots')")
    expect(payload).toContain('CLIENT_PRIMARY_CONTACT_ID')
    expect(payload).toContain('SPOUSE_PRIMARY_CONTACT_ID')
    expect(payload).toContain('return client.full_name || null')
    expect(payload).toContain('return spouse?.full_name || null')
  })
})
