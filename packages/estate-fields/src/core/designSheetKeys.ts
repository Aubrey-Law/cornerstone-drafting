/** Columns on `design_sheets` referenced by the shared field registry. */
export type DesignSheetKey =
  | 'client_name'
  | 'client_pronouns'
  | 'client_dob'
  | 'client_phone'
  | 'client_email'
  | 'client_citizenship'
  | 'client_domicile'
  | 'street'
  | 'city'
  | 'state'
  | 'zip'
  | 'county'
  | 'marital_status'
  | 'spouse_name'
  | 'spouse_pronouns'
  | 'spouse_dob'
  | 'spouse_phone'
  | 'spouse_email'
  | 'spouse_citizenship'
  | 'marriage_date'
  | 'concerns'
  | 'goals_notes'
  | 'trustee_slots'
  | 'executor_slots'
  | 'poa_slots'
  | 'hcp_slots'
  | 'guardian_slots'
  | 'spouse_trustee_slots'
  | 'spouse_executor_slots'
  | 'spouse_poa_slots'
  | 'spouse_hcp_slots'

/** Minimal sheet shape consumed by DesignField renderers. */
export type DesignSheetLike = Record<string, unknown>

export type DesignSectionChange = (field: DesignSheetKey | string, value: unknown) => void
