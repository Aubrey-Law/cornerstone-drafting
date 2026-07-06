import type { DesignSheetKey } from './designSheetKeys'

export type SharedFieldControl =
  | 'text'
  | 'email'
  | 'tel'
  | 'date'
  | 'textarea'
  | 'select'
  | 'boolean'
  | 'multiselect'

export interface FieldOption {
  value: string
  label: string
}

export type SharedFieldContext = {
  maritalStatus?: string | null
  clientName?: string | null
  spouseName?: string | null
}

export interface SharedFieldDef {
  /** Stable registry id, e.g. `marital_status`. */
  id: string
  label: string
  control: SharedFieldControl
  /** Column on design_sheets when this field is edited on the design sheet. */
  designKey?: DesignSheetKey
  /** Key on client_intake (or nested `_spouse` / household contact field). */
  intakeKey?: string
  /** Household contact attribute used during intake→design sync. */
  householdKey?: string
  options?: readonly FieldOption[]
  /** Dynamic options (e.g. child parentage labels). */
  optionsFor?: (ctx: SharedFieldContext) => FieldOption[]
  prefilled?: boolean
  placeholder?: string
  maxLength?: number
  normalize?: (raw: unknown) => string | null
  /** Map intake/household value into design-sheet storage. */
  intakeToDesign?: (raw: unknown, ctx?: SharedFieldContext) => string | null
}

export type SharedFieldId =
  | 'client_name'
  | 'client_pronouns'
  | 'client_dob'
  | 'client_phone'
  | 'client_email'
  | 'marital_status'
  | 'street'
  | 'city'
  | 'state'
  | 'zip'
  | 'county'
  | 'client_citizenship'
  | 'client_domicile'
  | 'spouse_name'
  | 'spouse_pronouns'
  | 'spouse_dob'
  | 'spouse_phone'
  | 'spouse_email'
  | 'spouse_citizenship'
  | 'marriage_date'
  | 'child_name'
  | 'child_dob'
  | 'child_relationship'
  | 'child_parentage'
  | 'concerns'
  | 'goals_notes'
  | 'planning_goals'
  | 'special_notes'
  | 'estate_value'
  | 'asset_types'
