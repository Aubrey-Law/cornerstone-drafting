import { describe, expect, it } from 'vitest'
import { DEFAULT_OFFICE_ADDRESS, firmOfficeAddress } from '@/lib/appointments/officeAddress'
import { locationHint } from '@/components/scheduling/bookingUi'

describe('firm office address', () => {
  it('defaults to the Needham office until firm settings have a street', () => {
    expect(DEFAULT_OFFICE_ADDRESS).toBe('1329 Highland Avenue, Needham, MA 02492')
    expect(firmOfficeAddress({ street: '', city: 'Needham, MA', state: '', zip: '' })).toBe(DEFAULT_OFFICE_ADDRESS)
    expect(firmOfficeAddress({})).toBe(DEFAULT_OFFICE_ADDRESS)
  })

  it('uses firm settings once a street is set', () => {
    expect(firmOfficeAddress({ street: '10 Main St', city: 'Boston', state: 'MA', zip: '02108' })).toBe('10 Main St, Boston, MA, 02108')
  })
})

describe('booking format copy', () => {
  it('does not promise a particular video service', () => {
    expect(locationHint('teams')).toBe('Video call — meeting link will be provided in your calendar invite')
  })

  it('names the office for in-person appointments', () => {
    expect(locationHint('in_person')).toBe('In person at our office (1329 Highland Avenue, Needham, MA 02492)')
    expect(locationHint('in_person', '10 Main St, Boston, MA')).toBe('In person at our office (10 Main St, Boston, MA)')
  })
})
