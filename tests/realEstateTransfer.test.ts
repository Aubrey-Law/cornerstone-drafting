import { describe, expect, it } from 'vitest'
import {
  coerceRealEstateTransferFields,
  fieldsToTemplateData,
  RealEstateTransferGenerateRequestSchema,
} from '@/lib/realEstateTransfer/fields'
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
})

describe('fieldsToTemplateData', () => {
  it('fills missing keys with empty strings for docxtemplater', () => {
    const data = fieldsToTemplateData({ grantor: 'Jane Doe' })
    expect(data.grantor).toBe('Jane Doe')
    expect(data.grantee).toBe('')
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
    property_address: '1 Main Street',
    property_city: 'Boston',
    property_state: 'MA',
    property_county: 'Suffolk',
    legal_description: 'Lot 1 on Plan Book 10 Page 5.',
    prior_deed_book: '12345',
    prior_deed_page: '67',
    registry_district: 'Suffolk South',
    parcel_id: '12-34-56',
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
