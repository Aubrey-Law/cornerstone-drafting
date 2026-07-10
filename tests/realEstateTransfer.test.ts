import { describe, expect, it } from 'vitest'
import {
  coerceRealEstateTransferFields,
  fieldsToTemplateData,
  RealEstateTransferGenerateRequestSchema,
} from '@/lib/realEstateTransfer/fields'
import {
  buildTemplateFields,
  emptyRealEstateTransferFormState,
  formatBeneficialOwners,
  formatGrantees,
  suggestRealtyTrustNames,
} from '@/lib/realEstateTransfer/formState'
import { renderRealEstateTransferPackage } from '@/lib/realEstateTransfer/generate'

describe('coerceRealEstateTransferFields', () => {
  it('keeps known string fields and drops empty values', () => {
    expect(coerceRealEstateTransferFields({
      grantor: ' Jane Doe ',
      grantee: '',
      trust_name: 'Doe Family Trust',
      extra: 'ignored',
    })).toEqual({
      grantor: 'Jane Doe',
      trust_name: 'Doe Family Trust',
    })
  })

  it('coerces new deed fields', () => {
    expect(coerceRealEstateTransferFields({
      prior_deed_date: '2020-05-01',
      certificate_number: '123456',
      beneficial_owners: 'Jane Doe (50%)',
    })).toEqual({
      prior_deed_date: '2020-05-01',
      certificate_number: '123456',
      beneficial_owners: 'Jane Doe (50%)',
    })
  })
})

describe('fieldsToTemplateData', () => {
  it('fills missing keys with empty strings for docxtemplater', () => {
    const data = fieldsToTemplateData({ grantor: 'Jane Doe' })
    expect(data.grantor).toBe('Jane Doe')
    expect(data.grantee).toBe('')
    expect(data.prior_deed_date).toBe('')
    expect(data.certificate_number).toBe('')
  })
})

describe('suggestRealtyTrustNames', () => {
  it('suggests street address and client last name trust names', () => {
    const form = {
      ...emptyRealEstateTransferFormState(),
      clientName: 'Jane Doe',
      clientPropertyAddress: '1 Main Street, Boston',
    }
    expect(suggestRealtyTrustNames(form)).toEqual([
      '1 Main Street Realty Trust',
      'Doe Realty Trust',
    ])
  })
})

describe('formatGrantees', () => {
  it('formats realty trust grantee with trustee language', () => {
    const form = {
      ...emptyRealEstateTransferFormState(),
      clientName: 'Jane Doe',
      realtyTrustName: '1 Main Street Realty Trust',
      trusteeContactId: '__design_sheet_client__',
      grantees: [{ id: '1', source: 'realty_trust' as const }],
    }
    expect(formatGrantees(form)).toBe('Jane Doe, Trustee of the 1 Main Street Realty Trust')
  })

  it('resolves trustee from contact id in fiduciaries', () => {
    const form = {
      ...emptyRealEstateTransferFormState(),
      clientName: 'Jane Doe',
      realtyTrustName: '1 Main Street Realty Trust',
      trusteeContactId: 'contact-9',
      trusteeSource: 'fiduciary' as const,
      fiduciaries: [{ id: 'contact-9', name: 'Alex Trustee' }],
      grantees: [{ id: '1', source: 'realty_trust' as const }],
    }
    expect(formatGrantees(form)).toBe('Alex Trustee, Trustee of the 1 Main Street Realty Trust')
  })
})

describe('formatBeneficialOwners', () => {
  it('formats owners with percentages', () => {
    const form = {
      ...emptyRealEstateTransferFormState(),
      clientName: 'Jane Doe',
      spouseName: 'John Doe',
      beneficialOwners: [
        { id: '1', source: 'client' as const, percentage: '50' },
        { id: '2', source: 'spouse' as const, percentage: '50' },
      ],
    }
    expect(formatBeneficialOwners(form)).toBe('Jane Doe (50%); John Doe (50%)')
  })
})

describe('buildTemplateFields', () => {
  it('merges client property, trust, and deed fields', () => {
    const form = {
      ...emptyRealEstateTransferFormState(),
      clientName: 'Jane Doe',
      clientPropertyAddress: '1 Main Street',
      clientPropertyCity: 'Boston',
      clientPropertyState: 'MA',
      realtyTrustName: 'Doe Realty Trust',
      realtyTrustDate: '2020-01-15',
      grantees: [{ id: '1', source: 'realty_trust' as const }],
      beneficialOwners: [{ id: '1', source: 'client' as const, percentage: '100' }],
      deedFields: {
        grantor: 'Prior Owner',
        legal_description: 'Lot 1.',
        prior_deed_book: '100',
        prior_deed_page: '200',
        prior_deed_date: '2015-01-01',
        certificate_number: '999',
      },
    }

    const fields = buildTemplateFields(form)
    expect(fields.grantor).toBe('Prior Owner')
    expect(fields.property_address).toBe('1 Main Street')
    expect(fields.property_city).toBe('Boston')
    expect(fields.trust_name).toBe('Doe Realty Trust')
    expect(fields.grantee).toBe('Jane Doe, Trustee of the Doe Realty Trust')
    expect(fields.beneficial_owners).toBe('Jane Doe (100%)')
    expect(fields.prior_deed_date).toBe('2015-01-01')
    expect(fields.certificate_number).toBe('999')
  })
})

describe('renderRealEstateTransferPackage', () => {
  const sampleFields = {
    grantor: 'Jane Doe',
    grantee: 'Jane Doe, Trustee of the Doe Family Trust',
    trustees: 'Jane Doe',
    settlor: 'Jane Doe',
    trust_name: 'Doe Family Trust',
    trust_date: '2020-01-15',
    beneficial_owners: 'Jane Doe (100%)',
    property_address: '1 Main Street',
    property_city: 'Boston',
    property_state: 'MA',
    property_county: 'Suffolk',
    legal_description: 'Lot 1 on Plan Book 10 Page 5.',
    prior_deed_book: '12345',
    prior_deed_page: '67',
    prior_deed_date: '2018-03-15',
    registry_district: 'Suffolk South',
    parcel_id: '12-34-56',
    certificate_number: '456789',
    consideration: 'one dollar',
    execution_date: '2026-07-07',
    certificate_execution_county: 'Suffolk',
  }

  it('renders a single deed DOCX', () => {
    const result = renderRealEstateTransferPackage(['deed'], sampleFields)
    expect(result.contentType).toContain('wordprocessingml')
    expect(result.filename).toMatch(/Deed/)
    expect(result.buffer.byteLength).toBeGreaterThan(1000)
  })

  it('renders a ZIP when multiple documents are selected', () => {
    const result = renderRealEstateTransferPackage(
      ['deed', 'trustees_certificate', 'real_estate_trust'],
      sampleFields,
    )
    expect(result.contentType).toBe('application/zip')
    expect(result.filename).toMatch(/\.zip$/)
    expect(result.buffer.byteLength).toBeGreaterThan(2000)
  })
})

describe('RealEstateTransferGenerateRequestSchema', () => {
  it('requires at least one document', () => {
    const parsed = RealEstateTransferGenerateRequestSchema.safeParse({
      fields: { grantor: 'Jane Doe' },
      documents: [],
    })
    expect(parsed.success).toBe(false)
  })
})
