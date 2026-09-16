export type StatularId = string | number
export type StatularGender = 'male' | 'female' | 'nonbinary'

export interface StatularAddress {
  streetAddress1?: string
  streetAddress2?: string
  city?: string
  county?: string
  state?: string
  zip?: string
}

export interface StatularChild {
  name: string
  relationship: 'joint' | 'settlor1' | 'settlor2'
  gender?: StatularGender
  birthdate?: string
  phone?: string
  email?: string
  address?: StatularAddress
  deceased?: boolean
}

export interface StatularClientPayload {
  first_name: string
  last_name: string
  middle_name?: string
  email?: string
  phone?: string
  dob?: string
  gender?: StatularGender
  marital_status?: string
  address?: StatularAddress
  partner?: boolean
  partner_first_name?: string
  partner_middle_name?: string
  partner_last_name?: string
  partner_email?: string
  partner_phone?: string
  partner_dob?: string
  partner_gender?: StatularGender
  partner_address?: StatularAddress
  children?: StatularChild[]
  notes?: string
}

export interface StatularMatterPayload {
  client_id: StatularId
  doc_id: StatularId
  state?: string
  matter_name?: string
  drafter_id?: StatularId
}

export interface StatularRecord {
  id: string
}
