import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * Scanning in the executed originals. The model's reading is bounded, the
 * scan is filed at once, and the record of the execution is proposed rather
 * than written: these pin each of those.
 */

vi.mock('server-only', () => ({}))

import { coerceScanReading, executedDocumentName, readingAgainstRequirement, summariseReading } from '@/lib/signing/scanReading'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG, autonomyCeilingForRisk } from '@/lib/actions/autonomy'

const MATTER = '00000000-0000-0000-0000-000000000060'
const DOCUMENT = '00000000-0000-0000-0000-000000000070'

describe('reading a scan', () => {
  it('keeps what the paper shows and bounds everything the model returns', () => {
    const reading = coerceScanReading({
      kind: 'will', signed_on: '2026-10-09', signers: [' Pat Smith '], witness_count: 2.4,
      witness_names: ['Dana Witness', 'Lee Witness', 'Extra', 'More', 'TooMany'], notarized: true,
      notary_name: 'Sam Notary', self_proving_affidavit: true, issues: ['Page 4 initials blank'], confidence: 1.7,
    })
    expect(reading).toEqual({
      kind: 'will', signedOn: '2026-10-09', signers: ['Pat Smith'], witnessCount: 2,
      witnessNames: ['Dana Witness', 'Lee Witness', 'Extra', 'More'], notarized: true, notaryName: 'Sam Notary',
      selfProvingAffidavit: true, issues: ['Page 4 initials blank'], confidence: 1,
    })
  })

  it('refuses an unknown kind, a malformed date and a non-object answer', () => {
    expect(coerceScanReading({ kind: 'codicil', signed_on: '10/09/2026', witness_count: -3 }))
      .toMatchObject({ kind: null, signedOn: null, witnessCount: 0, notarized: false, confidence: 0 })
    expect(coerceScanReading('nonsense').kind).toBeNull()
    expect(coerceScanReading({ kind: 'trust', signed_on: '2026-02-30' }).signedOn).toBeNull()
  })

  it('names the filed scan by date, kind and client, and keeps the file’s extension', () => {
    const reading = coerceScanReading({ kind: 'health_care_proxy', signed_on: '2026-10-09' })
    expect(executedDocumentName({ reading, clientName: 'Pat Smith', originalName: 'Scan 0042.PDF', fallbackDate: '2026-10-10' }))
      .toBe('2026-10-09 Executed - Health care proxy - Pat Smith.pdf')
    expect(executedDocumentName({ reading: coerceScanReading({}), clientName: null, originalName: 'IMG_1.jpg', fallbackDate: '2026-10-10' }))
      .toBe('2026-10-10 Executed - Unidentified document.jpg')
  })

  it('says where the reading falls short of what the document needed', () => {
    const will = coerceScanReading({ kind: 'will', signed_on: '2026-10-09', witness_count: 1, notarized: false, confidence: 0.9 })
    expect(readingAgainstRequirement(will)).toEqual([
      'Will needs 2 witnesses; 1 signed on the scan.',
      'Will: the self-proving affidavit does not appear complete.',
    ])
    const deed = coerceScanReading({ kind: 'deed', signed_on: null, notarized: false, confidence: 0.3, issues: ['Grantor line blank'] })
    expect(readingAgainstRequirement(deed)).toEqual([
      'Deed: no signing date could be read.',
      'Deed must be acknowledged before a notary; no completed acknowledgment was read.',
      'Low confidence reading; check the scan before recording.',
      'Grantor line blank',
    ])
    expect(readingAgainstRequirement(coerceScanReading({}))).toEqual(['The document kind could not be read; choose it before recording.'])
    expect(summariseReading(will)).toBe('Will, signed 2026-10-09, 1 witness, not notarised')
  })
})

describe('recording what the scan shows', () => {
  it('is a legal record: capped at Propose, confirmed by the attorney, with no undo', () => {
    const definition = getActionDefinition('signing.record.executed')
    expect(definition?.risk).toBe('legal_financial')
    expect(definition?.undo).toBeUndefined()
    expect(autonomyCeilingForRisk('legal_financial')).toBe('propose')
    expect(ACTION_CATALOG['signing.record.executed']?.group).toBe('matters')
  })

  it('needs the matter, the filed scan, a known kind, the signing date and a sane witness count', () => {
    const definition = getActionDefinition('signing.record.executed')!
    expect(definition.validate({
      matterId: MATTER, documentId: DOCUMENT, kind: 'will', signedOn: '2026-10-09', witnessCount: 2, notarized: true,
      signers: ['Pat Smith'], witnessNames: ['Dana', 'Lee'], notaryName: ' Sam Notary ', selfProvingAffidavit: true, originalsLocation: 'Firm vault',
    }, { id: 'u' })).toEqual({
      matterId: MATTER, documentId: DOCUMENT, kind: 'will', signedOn: '2026-10-09', signers: ['Pat Smith'], witnessCount: 2,
      witnessNames: ['Dana', 'Lee'], notarized: true, notaryName: 'Sam Notary', selfProvingAffidavit: true, originalsLocation: 'Firm vault',
    })
    expect(() => definition.validate({ matterId: MATTER, documentId: DOCUMENT, kind: 'codicil', signedOn: '2026-10-09', witnessCount: 0 }, { id: 'u' })).toThrow('known document kind')
    expect(() => definition.validate({ matterId: MATTER, documentId: DOCUMENT, kind: 'will', witnessCount: 2 }, { id: 'u' })).toThrow('signing date is required')
    expect(() => definition.validate({ matterId: MATTER, documentId: DOCUMENT, kind: 'will', signedOn: '2026-10-09', witnessCount: 7 }, { id: 'u' })).toThrow('between 0 and 4')
    expect(() => definition.validate({ matterId: MATTER, kind: 'will', signedOn: '2026-10-09', witnessCount: 2 }, { id: 'u' })).toThrow('document identifier')
  })

  it('writes through the ceremony repository, links the scan, and fills only what the record does not yet say', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const block = source.slice(source.indexOf("key: 'signing.record.executed'"), source.indexOf("key: 'signing.kit.prepare'"))
    expect(block).toContain('saveCeremonyDocument(client, {')
    expect(block).toContain('executedDocumentId: input.documentId')
    expect(block).toContain('notaryName: ceremony.notaryName ?? input.notaryName')
    expect(block).toContain('originalsLocation: input.originalsLocation ?? ceremony.originalsLocation')
    expect(block).toContain('documentProblems(roles, {')
    expect(block).not.toContain("from('ceremony_documents').insert")
  })
})

describe('the scan-in path', () => {
  it('files each scan as a firm document with its kind, then proposes the record keyed to the scan', () => {
    const source = fs.readFileSync('lib/signing/scanIn.ts', 'utf8')
    expect(source).toContain("source: 'firm'")
    expect(source).toContain('document_kind: input.reading.kind ?? null')
    expect(source).toContain("actionKey: 'signing.record.executed'")
    expect(source).toContain("source: 'record'")
    expect(source).toContain('idempotencyKey: `scan-in:${result.document.documentId}`')
    // A human upload, confirmed by hand: the dial is not consulted.
    expect(source).not.toContain('applyAutonomy')
    // The model reads the scan itself: a PDF as a document block, a photo as an image block.
    expect(source).toContain("type: 'document', source: { type: 'base64', media_type: 'application/pdf'")
    expect(source).toContain("type: 'image', source: { type: 'base64'")
    expect(source).toContain("route: 'signing/scan-in'")
  })

  it('is reachable from the Signing view and guarded like every other upload', () => {
    const route = fs.readFileSync('app/api/admin/matters/[id]/signing/scan-in/route.ts', 'utf8')
    expect(route).toContain('requireAdmin(req)')
    expect(route).toContain('SCAN_IN_MAX_FILES')
    expect(route).toContain("relationship_status !== 'hired'")
    expect(route).toContain("status === 'closed'")
    const panel = fs.readFileSync('app/admin/matters/[id]/tabs/signing/MatterSigningPanel.tsx', 'utf8')
    expect(panel).toContain('<ScanInExecuted matterId={matterId}')
    const card = fs.readFileSync('app/admin/matters/[id]/tabs/signing/ScanInExecuted.tsx', 'utf8')
    expect(card).toContain('/signing/scan-in')
    expect(card).toContain('<ApprovalInbox')
  })

  it('records where the originals are kept and which scan each record describes', () => {
    const migration = fs.readFileSync('supabase/migrations/20270109090000_signing_scan_in.sql', 'utf8')
    expect(migration).toContain('add column if not exists executed_document_id uuid')
    expect(migration).toContain('references public.matter_documents(id) on delete set null')
    expect(migration).toContain('add column if not exists originals_location text')
    const generated = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    expect(generated).toContain('executed_document_id: string | null')
    expect(generated).toContain('originals_location: string | null')
    const form = fs.readFileSync('app/admin/matters/[id]/tabs/signing/CeremonyRecord.tsx', 'utf8')
    expect(form).toContain('name="originalsLocation"')
    const actions = fs.readFileSync('app/admin/matters/[id]/tabs/signing/ceremonyActions.ts', 'utf8')
    expect(actions).toContain("originalsLocation: text(form, 'originalsLocation')")
  })
})
