import {
  ASSET_CATEGORIES,
  categoryLabel,
  isFunded,
  type AssetCategory,
  type FundingMethod,
  type FundingStatus,
} from './model'
import type { FundingAsset } from './rollup'

/**
 * The funding tracker as the client sees it.
 *
 * The firm's vocabulary (method, status) is about recording; the client's is
 * about doing. Each asset reads as one of five states: done, we are checking
 * what you sent, needs your action, we are handling it, or still to be
 * decided. The client acts on the third, and what they report never becomes
 * "confirmed" here: that word stays with the firm, after someone has read the
 * institution's paper (see isFunded in model.ts).
 *
 * Pure, so every sentence a client can be shown is a table in a test.
 */

export type PortalFundingState = 'done' | 'checking' | 'todo' | 'firm' | 'pending'

export interface PortalAsset {
  assetId: string
  category: string
  categoryLabel: string
  description: string
  ownership: string
  value: number | string | null
  method: FundingMethod
  status: FundingStatus
  confirmedOn: string | null
  /** 'staff', 'client' or 'import'. */
  source: string
  confirmationDocumentId: string | null
  clientReportedAt: string | null
  clientNote: string | null
  state: PortalFundingState
}

/** Methods the client carries out themselves, with the institution. */
const CLIENT_METHODS: readonly FundingMethod[] = ['retitle', 'beneficiary']

export function portalFundingState(asset: Pick<FundingAsset, 'method' | 'status'>): PortalFundingState {
  if (isFunded(asset.status)) return 'done'
  if (asset.status === 'awaiting_confirmation') return 'checking'
  if (CLIENT_METHODS.includes(asset.method)) return 'todo'
  if (asset.method === 'deed' || asset.method === 'assignment' || asset.method === 'none_required') return 'firm'
  return 'pending'
}

export const PORTAL_STATE_LABELS: Record<PortalFundingState, string> = {
  done: 'Done',
  checking: 'Confirmation received · we are checking it',
  todo: 'Needs your action',
  firm: 'We are handling this',
  pending: 'To be decided',
}

/**
 * What the client should do, in their terms, for the method the firm chose.
 * Only the two client-side methods ask anything of them.
 */
export function portalInstruction(asset: Pick<FundingAsset, 'method' | 'status' | 'category'>): string {
  const state = portalFundingState(asset)
  if (state === 'done') {
    return asset.status === 'not_applicable'
      ? 'Nothing was needed for this one.'
      : 'This is in your plan. Nothing more to do.'
  }
  if (state === 'checking') return 'Thank you. We will confirm once we have checked what the institution sent.'
  switch (asset.method) {
    case 'retitle':
      return 'Ask the institution to retitle this account in the name of your trust, then send us their written confirmation. We can give you the exact wording they need.'
    case 'beneficiary':
      return asset.category === 'retirement'
        ? 'Update the beneficiary designation with the institution as we advised (a retirement account is never retitled), then send us their confirmation.'
        : 'Update the beneficiary designation with the institution as we advised, then send us their confirmation.'
    case 'deed':
      return 'We prepare and record the new deed. Nothing for you to do unless we ask.'
    case 'assignment':
      return 'Covered by the assignment you signed with your plan. Nothing more for you to do.'
    case 'none_required':
      return 'Nothing is needed for this one.'
    default:
      return 'We will tell you what, if anything, this needs.'
  }
}

/** The client may report a step done (or re-send a confirmation) while it is theirs to do or being checked. */
export function clientMayReport(asset: Pick<FundingAsset, 'method' | 'status'>): boolean {
  const state = portalFundingState(asset)
  return state === 'todo' || state === 'checking'
}

export function toPortalAssets(assets: readonly FundingAsset[]): PortalAsset[] {
  return assets.map(asset => ({
    assetId: asset.assetId,
    category: asset.category,
    categoryLabel: categoryLabel(asset.category),
    description: asset.description,
    ownership: asset.ownership,
    value: asset.value,
    method: asset.method,
    status: asset.status,
    confirmedOn: asset.confirmedOn,
    source: asset.source ?? 'staff',
    confirmationDocumentId: asset.confirmationDocumentId ?? null,
    clientReportedAt: asset.clientReportedAt ?? null,
    clientNote: asset.clientNote ?? null,
    state: portalFundingState(asset),
  }))
}

const STATE_ORDER: Record<PortalFundingState, number> = { todo: 0, checking: 1, pending: 2, firm: 3, done: 4 }

/** The client's own work first, then what is being checked, then the rest. */
export function sortPortalAssets(assets: readonly PortalAsset[]): PortalAsset[] {
  return [...assets].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.description.localeCompare(b.description))
}

export interface PortalFundingSummary {
  total: number
  done: number
  todo: number
  checking: number
}

export function summarisePortalAssets(assets: readonly PortalAsset[]): PortalFundingSummary {
  return {
    total: assets.length,
    done: assets.filter(asset => asset.state === 'done').length,
    todo: assets.filter(asset => asset.state === 'todo').length,
    checking: assets.filter(asset => asset.state === 'checking').length,
  }
}

/** The categories a client may file an asset under. The firm's own list, minus "expected inheritance". */
export const CLIENT_ASSET_CATEGORIES = ASSET_CATEGORIES.filter(category => category !== 'inheritance')

export const CLIENT_OWNERSHIP = ['client', 'spouse', 'joint'] as const
export type ClientOwnership = (typeof CLIENT_OWNERSHIP)[number]

export const OWNERSHIP_LABELS: Record<ClientOwnership, string> = {
  client: 'Mine',
  spouse: 'My spouse’s',
  joint: 'Joint',
}

export interface ClientAssetInput {
  category: AssetCategory
  description: string
  value: number
  ownership: ClientOwnership
  details: { institution?: string; account_hint?: string; note?: string }
}

export const CLIENT_ASSET_DESCRIPTION_MAX = 200

/**
 * An asset as the client describes it, checked and trimmed. Throws with a
 * sentence the form can show. The value is optional and approximate; a client
 * who does not know a balance should still be able to tell us the account
 * exists.
 */
export function parseClientAssetInput(value: unknown): ClientAssetInput {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  if (!(CLIENT_ASSET_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error('Choose what kind of asset this is')
  }
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) throw new Error('Describe the asset, for example the bank and the kind of account')
  if (description.length > CLIENT_ASSET_DESCRIPTION_MAX) {
    throw new Error(`Keep the description to ${CLIENT_ASSET_DESCRIPTION_MAX} characters`)
  }
  const ownership = typeof input.ownership === 'string' ? input.ownership : 'client'
  if (!(CLIENT_OWNERSHIP as readonly string[]).includes(ownership)) throw new Error('Say whose asset this is')
  const rawValue = input.value
  const numeric = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string' && rawValue.trim()
      ? Number.parseFloat(rawValue.replace(/[,$\s]/g, ''))
      : 0
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('The approximate value must be a number')
  const text = (key: string, max: number): string | undefined => {
    const raw = input[key]
    const trimmed = typeof raw === 'string' ? raw.trim().slice(0, max) : ''
    return trimmed || undefined
  }
  return {
    category,
    description,
    value: Math.round(numeric),
    ownership: ownership as ClientOwnership,
    details: {
      institution: text('institution', 120),
      account_hint: text('accountHint', 40),
      note: text('note', 500),
    },
  }
}

export const CLIENT_REPORT_NOTE_MAX = 500

/** The optional note a client sends with "I've done this". */
export function parseClientReportNote(value: unknown): string | null {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  return note ? note.slice(0, CLIENT_REPORT_NOTE_MAX) : null
}
