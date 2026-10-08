import type { DesignSheetKey } from './designSheetKeys'
import type { IntakeCatalogFieldId } from './intakeCatalog'

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
  builderEnabled?: boolean
  baselineRequirement?: 'optional' | 'recommended' | 'required'
  validationProfile?: 'none' | 'email' | 'phone' | 'ma_county' | 'date'
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
  /** Stored values from retired option sets: not offered in pickers, but a row
   *  carrying one must not fail validation (it would block submission with a
   *  blank select and no visible reason). */
  legacyValues?: readonly string[]
  /** Dynamic options (e.g. child parentage labels). */
  optionsFor?: (ctx: SharedFieldContext) => FieldOption[]
  prefilled?: boolean
  placeholder?: string
  maxLength?: number
  normalize?: (raw: unknown) => string | null
  /** Map intake/household value into design-sheet storage. */
  intakeToDesign?: (raw: unknown, ctx?: SharedFieldContext) => string | null
}

export interface BuilderFieldDef extends SharedFieldDef {
  builderEnabled: true
  baselineRequirement: 'optional' | 'recommended' | 'required'
  /** Historical intake selects that were presence-checked only keep that
   * behavior. The compiler still restricts definitions to approved options. */
  intakeOptionValidation?: 'legacy_presence'
  read: (data: Readonly<Record<string, unknown>>) => unknown
  write: (value: unknown, update: (field: string, value: unknown) => void) => void
}

export type SharedFieldId =
  | IntakeCatalogFieldId
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
