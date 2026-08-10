import type { EmailCategory } from './categories'

/**
 * The `{{placeholder}}` tags an email template may use.
 *
 * One registry so the manual composer, the template builder, and the send
 * pipeline agree on what is spellable. Keys are snake_case — that is the form
 * every send path supplies, and the form the builder's help text documents.
 */
export interface EmailTemplateVariableOption {
  key: string
  label: string
  /** What it stands for, shown to whoever is authoring the template. */
  hint: string
}

/** Available on every category — the send paths all resolve these. */
const RECIPIENT_VARIABLES: EmailTemplateVariableOption[] = [
  { key: 'first_name', label: 'First name', hint: "The recipient's first name" },
  { key: 'client_name', label: 'Client name', hint: 'Full name on the record' },
]

const CONTACT_VARIABLES: EmailTemplateVariableOption[] = [
  { key: 'client_first_name', label: 'Client first name', hint: "The client's first name" },
  { key: 'lead_name', label: 'Lead name', hint: 'Full name on the lead' },
  { key: 'spouse_name', label: 'Spouse name', hint: "The spouse's full name" },
  { key: 'spouse_first_name', label: 'Spouse first name', hint: "The spouse's first name" },
]

const INTAKE_LINK_VARIABLE: EmailTemplateVariableOption = {
  key: 'intake_link',
  label: 'Intake link',
  hint: 'Secure link to the questionnaire',
}

/** Categories whose send path resolves the intake link. */
const INTAKE_LINK_CATEGORIES: EmailCategory[] = [
  'intake_invite',
  'intake_invite_college_prep',
  'manual',
]

/**
 * The variables offered when authoring a template for `category`. Offering a
 * tag the send path never resolves would leave a literal `{{…}}` in a client's
 * inbox, so this stays keyed to what each path actually supplies.
 */
export function emailTemplateVariables(
  category: EmailCategory | null | undefined,
): EmailTemplateVariableOption[] {
  const options = [...RECIPIENT_VARIABLES, ...CONTACT_VARIABLES]
  if (category && INTAKE_LINK_CATEGORIES.includes(category)) options.push(INTAKE_LINK_VARIABLE)
  return options
}

/** Every variable the manual composer can resolve, regardless of category. */
export const MANUAL_EMAIL_VARIABLES: EmailTemplateVariableOption[] = [
  ...RECIPIENT_VARIABLES,
  ...CONTACT_VARIABLES,
  INTAKE_LINK_VARIABLE,
]

/** Wrap a key in the placeholder syntax `renderEmailTemplateText` matches. */
export function emailTemplateToken(key: string): string {
  return `{{${key}}}`
}
