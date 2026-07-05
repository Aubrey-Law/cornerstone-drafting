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

  it('renders spouse fiduciary blocks for married matters in the applicable document sections', () => {
    const sections = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DocumentSections.tsx'), 'utf8')

    expect(sections).toContain('slotField="spouse_trustee_slots"')
    // Trustee blocks are now titled with first names, e.g. "Jon's Trustees".
    expect(sections).toContain("'s Trustees")
    expect(sections).toContain('isMarried(sheet) && sheet.is_joint === false')
    expect(sections).toContain('slotField="spouse_executor_slots"')
    expect(sections).toContain('sectionTitle="Spouse / Partner Personal Representative"')
    expect(sections).toContain('slotField="spouse_poa_slots"')
    expect(sections).toContain('sectionTitle="Spouse / Partner Durable Power of Attorney"')
    expect(sections).toContain('slotField="spouse_hcp_slots"')
    expect(sections).toContain('sectionTitle="Spouse / Partner Health Care Proxy"')
    expect(sections).toContain('CLIENT_PRIMARY_CONTACT_ID')
    expect(sections).toContain('SPOUSE_PRIMARY_CONTACT_ID')
    expect(sections).toContain('primaryShortcutContact={clientContact}')
    expect(sections).toContain('as initial trustee of')
    expect(sections).toContain("'trustee_slots',")
    expect(sections).toContain("'spouse_trustee_slots',")
    expect(sections).toContain('Client as spouse / partner DPOA agent')
    expect(sections).toContain('Client as spouse / partner health care agent')
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
