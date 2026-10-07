import { normaliseRequestTitle, type DocumentRequest } from './model'

/**
 * The standard probate document list: what the firm asks a personal
 * representative for at the start of every estate. Pure, so which items are
 * offered, which are already on the matter and what a send would add are all
 * tested without a database.
 *
 * The list is a starting point, not a rule: the attorney sees every item with
 * a tick box before anything goes to the client, and anything an estate needs
 * beyond it is a one-off request typed on the same card.
 */

export const REQUEST_SECTIONS = ['death', 'will', 'heirs', 'assets', 'debts', 'taxes'] as const
export type RequestSection = (typeof REQUEST_SECTIONS)[number]

/** What the client reads above each group in the portal. */
export const REQUEST_SECTION_LABELS: Record<RequestSection, string> = {
  death: 'Death certificate',
  will: 'The will and estate papers',
  heirs: 'Family and heirs',
  assets: 'What the estate owns',
  debts: 'What the estate owes',
  taxes: 'Taxes',
}

export function isRequestSection(value: unknown): value is RequestSection {
  return typeof value === 'string' && (REQUEST_SECTIONS as readonly string[]).includes(value)
}

export interface ProbateRequestItem {
  key: string
  section: RequestSection
  title: string
  description: string
  /** Ticked when the list opens. Items that only some estates have start unticked. */
  defaultSelected: boolean
}

export const PROBATE_REQUEST_ITEMS: readonly ProbateRequestItem[] = [
  {
    key: 'death_certificate',
    section: 'death',
    title: 'Certified copy of the death certificate',
    description: 'A scan or photo is fine for now. Keep the certified copies safe; we will tell you if an original is needed.',
    defaultSelected: true,
  },
  {
    key: 'original_will',
    section: 'will',
    title: 'The will and any codicils',
    description: 'Upload a scan and tell us where the original is kept. Please do not mail the original until we ask for it.',
    defaultSelected: true,
  },
  {
    key: 'trust_documents',
    section: 'will',
    title: 'Any trust the decedent created, with its amendments',
    description: 'Only if there is one.',
    defaultSelected: false,
  },
  {
    key: 'heirs_list',
    section: 'heirs',
    title: 'Names and addresses of the spouse, children and other close family',
    description: 'Say how each person is related. Include family members who have died, with the year they died.',
    defaultSelected: true,
  },
  {
    key: 'bank_statements',
    section: 'assets',
    title: 'Statements for every bank, brokerage and retirement account',
    description: 'The statement covering the date of death is the most useful one.',
    defaultSelected: true,
  },
  {
    key: 'real_estate',
    section: 'assets',
    title: 'The deed and latest tax bill for any real estate',
    description: 'Include property in other states.',
    defaultSelected: true,
  },
  {
    key: 'vehicles',
    section: 'assets',
    title: 'The title or registration for each vehicle',
    description: 'Cars, boats and trailers in the decedent’s name.',
    defaultSelected: false,
  },
  {
    key: 'life_insurance',
    section: 'assets',
    title: 'Life insurance policies and annuities',
    description: 'Any statement or letter that names the beneficiary.',
    defaultSelected: true,
  },
  {
    key: 'funeral_bill',
    section: 'debts',
    title: 'The funeral bill, and a receipt if it has been paid',
    description: 'Say who paid it.',
    defaultSelected: true,
  },
  {
    key: 'bills',
    section: 'debts',
    title: 'Bills that have arrived since the death',
    description: 'Credit cards, medical bills, loans and utilities. Please do not pay them from your own money before we talk.',
    defaultSelected: true,
  },
  {
    key: 'mortgage',
    section: 'debts',
    title: 'The latest statement for any mortgage or home equity loan',
    description: 'Only if there is one.',
    defaultSelected: false,
  },
  {
    key: 'tax_returns',
    section: 'taxes',
    title: 'The last three years of income tax returns',
    description: 'Federal and state, with any letters from the IRS or the Department of Revenue.',
    defaultSelected: true,
  },
]

const ITEM_BY_KEY = new Map(PROBATE_REQUEST_ITEMS.map(item => [item.key, item]))

export function probateRequestItem(key: string): ProbateRequestItem | null {
  return ITEM_BY_KEY.get(key) ?? null
}

type ExistingRequest = Pick<DocumentRequest, 'title' | 'status'> & { templateKey: string | null }

/**
 * The request already on the matter for a list item: one made from the same
 * item (whatever its status, so a waived item stays waived), or a live one
 * typed by hand with the same title.
 */
export function existingRequestFor(item: ProbateRequestItem, requests: readonly ExistingRequest[]): ExistingRequest | null {
  const byKey = requests.find(request => request.templateKey === item.key)
  if (byKey) return byKey
  const title = normaliseRequestTitle(item.title).toLowerCase()
  return requests.find(request => request.status !== 'waived' && normaliseRequestTitle(request.title).toLowerCase() === title) ?? null
}

export interface ProbateSetOption extends ProbateRequestItem {
  /** Already on the matter, so it cannot be sent again from the list. */
  alreadyRequested: boolean
}

/** Every list item, marked with whether this matter already has it. */
export function probateSetOptions(requests: readonly ExistingRequest[]): ProbateSetOption[] {
  return PROBATE_REQUEST_ITEMS.map(item => ({ ...item, alreadyRequested: existingRequestFor(item, requests) !== null }))
}

export interface ProbateSetPlan {
  create: ProbateRequestItem[]
  /** Chosen, but the matter already has it. */
  skipped: string[]
  /** Not a key on the list. */
  unknown: string[]
}

/** What sending the chosen items would add to the matter, in list order. */
export function planProbateSet(keys: readonly string[], requests: readonly ExistingRequest[]): ProbateSetPlan {
  const chosen = new Set(keys)
  const unknown = [...chosen].filter(key => !ITEM_BY_KEY.has(key))
  const create: ProbateRequestItem[] = []
  const skipped: string[] = []
  for (const item of PROBATE_REQUEST_ITEMS) {
    if (!chosen.has(item.key)) continue
    if (existingRequestFor(item, requests)) skipped.push(item.key)
    else create.push(item)
  }
  return { create, skipped, unknown }
}

export interface RequestGroup<T> {
  section: RequestSection | null
  label: string
  requests: T[]
}

/**
 * The portal's list, grouped under the standard sections in their order, with
 * one-off requests last under "Other requests". A matter with no sectioned
 * request gets one ungrouped list, as before.
 */
export function groupRequestsBySection<T extends { section: RequestSection | null }>(requests: readonly T[]): RequestGroup<T>[] {
  if (!requests.some(request => request.section !== null)) {
    return requests.length > 0 ? [{ section: null, label: '', requests: [...requests] }] : []
  }
  const groups: RequestGroup<T>[] = []
  for (const section of REQUEST_SECTIONS) {
    const inSection = requests.filter(request => request.section === section)
    if (inSection.length > 0) groups.push({ section, label: REQUEST_SECTION_LABELS[section], requests: inSection })
  }
  const other = requests.filter(request => request.section === null)
  if (other.length > 0) groups.push({ section: null, label: 'Other requests', requests: other })
  return groups
}
