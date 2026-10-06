import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Client self-entry of assets, and client-reported retitling with the
 * institution's confirmation attached. These pin the client's view of the
 * tracker (what each state says, who acts), the one rule the slice must not
 * bend (what the client reports is never "confirmed"), the shape of what a
 * client may file, and where it is wired.
 */

import {
  CLIENT_ASSET_CATEGORIES,
  clientMayReport,
  parseClientAssetInput,
  parseClientReportNote,
  portalFundingState,
  portalInstruction,
  sortPortalAssets,
  summarisePortalAssets,
  toPortalAssets,
} from '@/lib/funding/portal'
import { toFundingAssets, type FundingJoinRow } from '@/lib/funding/rollup'
import type { FundingAsset } from '@/lib/funding/rollup'

function asset(overrides: Partial<FundingAsset> = {}): FundingAsset {
  return {
    assetId: 'a1',
    category: 'bank',
    description: 'Chase checking',
    ownership: 'client',
    value: 12_000,
    method: 'retitle',
    status: 'not_started',
    confirmedOn: null,
    note: null,
    isRecorded: false,
    source: 'staff',
    confirmationDocumentId: null,
    clientReportedAt: null,
    clientNote: null,
    ...overrides,
  }
}

describe('how an asset reads to the client', () => {
  it('is theirs to do only for the methods they carry out with the institution', () => {
    expect(portalFundingState(asset({ method: 'retitle' }))).toBe('todo')
    expect(portalFundingState(asset({ method: 'beneficiary', category: 'retirement' }))).toBe('todo')
    expect(portalFundingState(asset({ method: 'deed', category: 'real_estate' }))).toBe('firm')
    expect(portalFundingState(asset({ method: 'assignment', category: 'business' }))).toBe('firm')
    expect(portalFundingState(asset({ method: 'none_required' }))).toBe('firm')
    expect(portalFundingState(asset({ method: 'undecided', category: 'vehicles' }))).toBe('pending')
  })

  it('reads as done only when the firm has confirmed it, and as checking once the client has reported', () => {
    expect(portalFundingState(asset({ status: 'confirmed', confirmedOn: '2026-10-01' }))).toBe('done')
    expect(portalFundingState(asset({ status: 'not_applicable' }))).toBe('done')
    expect(portalFundingState(asset({ status: 'awaiting_confirmation' }))).toBe('checking')
    expect(portalFundingState(asset({ status: 'in_progress' }))).toBe('todo')
  })

  it('tells a retirement account owner never to retitle it', () => {
    expect(portalInstruction(asset({ method: 'beneficiary', category: 'retirement' }))).toContain('never retitled')
    expect(portalInstruction(asset({ method: 'retitle' }))).toContain('retitle this account in the name of your trust')
    expect(portalInstruction(asset({ method: 'deed', category: 'real_estate' }))).toContain('We prepare and record')
    expect(portalInstruction(asset({ status: 'awaiting_confirmation' }))).toContain('once we have checked')
    expect(portalInstruction(asset({ status: 'confirmed', confirmedOn: '2026-10-01' }))).toContain('Nothing more to do')
  })

  it('lets the client report while a step is theirs or being checked, never once it is done or the firm’s', () => {
    expect(clientMayReport(asset({ method: 'retitle' }))).toBe(true)
    expect(clientMayReport(asset({ status: 'awaiting_confirmation' }))).toBe(true)
    expect(clientMayReport(asset({ status: 'confirmed', confirmedOn: '2026-10-01' }))).toBe(false)
    expect(clientMayReport(asset({ method: 'deed', category: 'real_estate' }))).toBe(false)
    expect(clientMayReport(asset({ method: 'undecided' }))).toBe(false)
  })

  it('puts the client’s own work first and counts it', () => {
    const list = toPortalAssets([
      asset({ assetId: 'done', status: 'confirmed', confirmedOn: '2026-10-01', description: 'A' }),
      asset({ assetId: 'firm', method: 'deed', category: 'real_estate', description: 'B' }),
      asset({ assetId: 'todo', description: 'C' }),
      asset({ assetId: 'checking', status: 'awaiting_confirmation', description: 'D', confirmationDocumentId: 'doc-1', clientReportedAt: '2026-10-05T12:00:00Z' }),
    ])
    expect(sortPortalAssets(list).map(item => item.assetId)).toEqual(['todo', 'checking', 'firm', 'done'])
    expect(summarisePortalAssets(list)).toEqual({ total: 4, done: 1, todo: 1, checking: 1 })
    expect(list.find(item => item.assetId === 'checking')).toMatchObject({ confirmationDocumentId: 'doc-1', state: 'checking' })
  })
})

describe('the rows behind it', () => {
  it('carries the client’s report through the rollup and reads an older row as staff-entered', () => {
    const rows: FundingJoinRow[] = [
      {
        matter_id: 'm', matter_title: 'Smith', matter_stage: 'funding', asset_id: 'a', category: 'bank',
        description: 'Chase', ownership: 'client', value: 100, method: 'retitle', status: 'awaiting_confirmation',
        confirmed_on: null, note: null, source: 'client', confirmation_document_id: 'doc', client_reported_at: '2026-10-05T00:00:00Z', client_note: 'Sent the letter',
      },
      {
        matter_id: 'm', matter_title: 'Smith', matter_stage: 'funding', asset_id: 'b', category: 'real_estate',
        description: 'House', ownership: 'joint', value: 500, method: null, status: null, confirmed_on: null, note: null,
      },
    ]
    const [reported, untouched] = toFundingAssets(rows)
    expect(reported).toMatchObject({ source: 'client', confirmationDocumentId: 'doc', clientReportedAt: '2026-10-05T00:00:00Z', clientNote: 'Sent the letter' })
    expect(untouched).toMatchObject({ source: 'staff', confirmationDocumentId: null, clientReportedAt: null, method: 'deed', status: 'not_started' })
  })

  it('reads the new columns and falls back to the old list before the migration has run', () => {
    const source = fs.readFileSync('lib/funding/repository.ts', 'utf8')
    expect(source).toContain("'id, category, description, ownership, value, client_intake_id, source'")
    expect(source).toContain('confirmation_document_id, client_reported_at, client_note')
    expect(source).toContain('selectWithFallback(')
    expect(source).toContain("error.code === '42703'")
  })
})

describe('what a client may file', () => {
  it('accepts a described asset with an approximate value, trimming what it keeps', () => {
    expect(parseClientAssetInput({
      category: 'bank', description: '  Chase checking ', value: '$12,500.40', ownership: 'joint',
      institution: 'Chase', accountHint: '…1234', note: 'Opened last year',
    })).toEqual({
      category: 'bank', description: 'Chase checking', value: 12_500, ownership: 'joint',
      details: { institution: 'Chase', account_hint: '…1234', note: 'Opened last year' },
    })
    expect(parseClientAssetInput({ category: 'real_estate', description: '12 Elm St' })).toMatchObject({ value: 0, ownership: 'client' })
  })

  it('refuses what it cannot file, in a sentence the form can show', () => {
    expect(() => parseClientAssetInput({ category: 'inheritance', description: 'x' })).toThrow('what kind of asset')
    expect(() => parseClientAssetInput({ category: 'bank', description: '' })).toThrow('Describe the asset')
    expect(() => parseClientAssetInput({ category: 'bank', description: 'x'.repeat(201) })).toThrow('200 characters')
    expect(() => parseClientAssetInput({ category: 'bank', description: 'x', ownership: 'trust' })).toThrow('whose asset')
    expect(() => parseClientAssetInput({ category: 'bank', description: 'x', value: 'lots' })).toThrow('must be a number')
    expect(CLIENT_ASSET_CATEGORIES).not.toContain('inheritance')
    expect(CLIENT_ASSET_CATEGORIES).toContain('retirement')
  })

  it('keeps a report note short and optional', () => {
    expect(parseClientReportNote({ note: '  Called the bank  ' })).toBe('Called the bank')
    expect(parseClientReportNote({})).toBeNull()
    expect(parseClientReportNote({ note: 'x'.repeat(600) })).toHaveLength(500)
  })
})

describe('what the client reports is never confirmed', () => {
  const server = fs.readFileSync('lib/funding/portalServer.ts', 'utf8')

  it('moves the asset to awaiting confirmation with the document linked, and refuses one already done', () => {
    const body = server.slice(server.indexOf('export async function recordClientRetitling'))
    expect(body).toContain("status: 'awaiting_confirmation'")
    expect(body).not.toContain("status: 'confirmed'")
    expect(body).toContain('confirmed_on: null')
    expect(body).toContain('confirmation_document_id: input.documentId')
    expect(body).toContain('client_reported_at: now')
    expect(body).toContain('if (isFunded(status))')
    expect(body).toContain("eq('client_intake_id', clientIntakeId)")
  })

  it('asks the firm to check it through the dial, as a task keyed to the asset and the document', () => {
    expect(server).toContain('delegateFundingConfirmationReview(')
    const review = fs.readFileSync('lib/funding/delegateReview.ts', 'utf8')
    expect(review).toContain("actionKey: 'task.create'")
    expect(review).toContain('idempotencyKey: `funding-review:${input.matterId}:${input.assetId}:${input.documentId ?? \'no-document\'}`')
    expect(review).toContain('applyAutonomy: true')
  })

  it('files a client-added asset as the client’s and syncs the design sheet', () => {
    const body = server.slice(server.indexOf('export async function createClientAsset'), server.indexOf('export type ClientReportResult'))
    expect(body).toContain("source: 'client'")
    expect(body).toContain('syncAssetIntakeToDesignSheet(client, input.matterId, clientIntakeId)')
  })
})

describe('where it is wired', () => {
  it('has its routes, each resolving the signed-in client to their own matter', () => {
    const list = fs.readFileSync('app/api/portal/assets/route.ts', 'utf8')
    const done = fs.readFileSync('app/api/portal/assets/[assetId]/done/route.ts', 'utf8')
    for (const route of [list, done]) {
      expect(route).toContain('getBearerUser(req)')
      expect(route).toContain('getMatterForUser(getAdminClient(), user.id)')
      expect(route).toContain("'closed'")
    }
    expect(list).toContain('parseClientAssetInput(body)')
    expect(done).toContain('documentId: null')
  })

  it('attaches an uploaded confirmation to the asset from the shared upload route', () => {
    const upload = fs.readFileSync('app/api/documents/upload/route.ts', 'utf8')
    expect(upload).toContain("form.get('assetId')")
    expect(upload).toContain('recordClientRetitling({ matterId, assetId, documentId: String(data.id)')
    expect(upload).toContain('!isAdmin')
    const documents = fs.readFileSync('lib/documents.ts', 'utf8')
    expect(documents).toContain("form.append('assetId', options.assetId)")
  })

  it('is a portal page the shell, the proxy and the login redirect all know', () => {
    expect(fs.existsSync('app/(portal)/assets/page.tsx')).toBe(true)
    expect(fs.readFileSync('app/(portal)/PortalShell.tsx', 'utf8')).toContain("{ href: '/assets', label: 'Assets'")
    const proxy = fs.readFileSync('proxy.ts', 'utf8')
    expect(proxy).toContain("'/documents', '/assets', '/messages'")
    expect(proxy.slice(proxy.indexOf('matcher: ['))).toContain("'/assets/:path*'")
    expect(fs.readFileSync('lib/auth/safeRedirect.ts', 'utf8')).toContain("'/assets',")
  })

  it('surfaces on the dashboard once the plan is signed, and on the matter’s funding tab for staff', () => {
    const dashboard = fs.readFileSync('app/(portal)/dashboard/page.tsx', 'utf8')
    expect(dashboard).toContain('settled(fetchPortalAssets(matter.id), [] as PortalAsset[])')
    expect(dashboard).toContain('fundingTodoCount: funding.todo')
    expect(dashboard).toContain('Moving your assets into the plan')
    const row = fs.readFileSync('app/admin/matters/[id]/tabs/funding/AssetRow.tsx', 'utf8')
    expect(row).toContain('Client reported this done on')
    expect(row).toContain('View the confirmation')
    expect(row).toContain("asset.source === 'client'")
  })

  it('has its migration, with client read access scoped to their own matter, and generated types', () => {
    const migration = fs.readFileSync('supabase/migrations/20270114090000_portal_asset_funding.sql', 'utf8')
    expect(migration).toContain('add column if not exists confirmation_document_id uuid')
    expect(migration).toContain('add column if not exists client_reported_at timestamptz')
    expect(migration).toContain("check (source in ('staff', 'client', 'import'))")
    expect(migration).toContain('asset_funding_client_select')
    expect(migration).toContain('ci.user_id = (select auth.uid()) or ci.client_user_id = (select auth.uid())')
    expect(migration).not.toMatch(/for (insert|update|all) to authenticated/i)

    const types = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    const funding = types.slice(types.indexOf('      asset_funding: {'), types.indexOf('      asset_intake: {'))
    expect(funding).toContain('confirmation_document_id: string | null')
    expect(funding).toContain('client_reported_at: string | null')
    expect(funding).toContain('asset_funding_confirmation_document_id_fkey')
    const intake = types.slice(types.indexOf('      asset_intake: {'), types.indexOf('      assistant_chat_messages: {'))
    expect(intake).toContain('source: string')
  })
})
