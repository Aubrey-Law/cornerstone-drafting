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

  it('renders spouse fiduciary blocks in document sections for married matters', () => {
    const fiduciaries = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FiduciariesSectionEP.tsx'), 'utf8')
    const documentFiduciaries = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/documentFiduciarySections.tsx'), 'utf8')
    const trustDetails = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx'), 'utf8')
    const blocks = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/fiduciary-blocks.tsx'), 'utf8')

    expect(fiduciaries).toContain('FiduciaryCardGrid')
    expect(fiduciaries).toContain('All Fiduciaries and Decisionmakers')
    expect(documentFiduciaries).toContain('slotField="spouse_trustee_slots"')
    expect(documentFiduciaries).toContain("'s Trustees")
    expect(documentFiduciaries).toContain('separateTrusts')
    expect(documentFiduciaries).toContain('slotField="spouse_executor_slots"')
    expect(documentFiduciaries).toContain('sectionTitle="Spouse / Partner Personal Representative"')
    expect(documentFiduciaries).toContain('slotField="spouse_poa_slots"')
    expect(documentFiduciaries).toContain('sectionTitle="Spouse / Partner Durable Power of Attorney"')
    expect(documentFiduciaries).toContain('slotField="spouse_hcp_slots"')
    expect(documentFiduciaries).toContain('sectionTitle="Spouse / Partner Health Care Proxy"')
    expect(blocks).toContain('CLIENT_PRIMARY_CONTACT_ID')
    expect(blocks).toContain('SPOUSE_PRIMARY_CONTACT_ID')
    expect(documentFiduciaries).toContain('primaryShortcutContact={clientContact}')
    expect(trustDetails).toContain('as initial trustee of')
    expect(trustDetails).toContain("'trustee_slots',")
    expect(trustDetails).toContain("'spouse_trustee_slots',")
    expect(documentFiduciaries).toContain('Client as spouse / partner DPOA agent')
    expect(documentFiduciaries).toContain('Client as spouse / partner health care agent')
  })

  it('includes spouse fiduciaries in readiness and drafting payload paths', () => {
    const readiness = fs.readFileSync(path.join(process.cwd(), 'lib/designSheetReadiness.ts'), 'utf8')
    const payload = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/helpers.ts'), 'utf8')

    expect(readiness).toContain('spouseFiduciariesNeeded')
    expect(readiness).toContain("'spouse trustee'")
    expect(readiness).toContain("'spouse personal representative'")
    expect(readiness).toContain("'spouse power of attorney agent'")
    expect(readiness).toContain("'spouse health care proxy'")
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
