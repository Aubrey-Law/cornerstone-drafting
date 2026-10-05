import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * The signing-day kit. What a plan needs in the room is a table drawn from
 * the execution rules; these pin that table, the kind recorded at generation
 * replacing the filename guess, and the kit's path through the dial.
 */

vi.mock('server-only', () => ({}))

import { buildSigningDayKit, summariseSigningKit } from '@/lib/signing/kit'
import { documentKindForOutputSlug, documentKindForTemplate, resolveDocumentKinds } from '@/lib/execution/documentKind'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG, autonomyCeilingForRisk } from '@/lib/actions/autonomy'

const MATTER = '00000000-0000-0000-0000-000000000060'

describe('the kind recorded at generation', () => {
  it('reads the generator’s own template names, including the ones a filename guess gets wrong', () => {
    expect(documentKindForOutputSlug('pourover-will.docx')).toBe('will')
    expect(documentKindForOutputSlug('02-testamentary-trust-will.docx')).toBe('will')
    expect(documentKindForOutputSlug('trustees-certificate.docx')).toBe('certificate_of_trust')
    expect(documentKindForOutputSlug('homestead-trustee.docx')).toBe('homestead_declaration')
    expect(documentKindForOutputSlug('deed-landcourt.docx')).toBe('deed')
    expect(documentKindForOutputSlug('college-financial-poa.docx')).toBe('dpoa')
    expect(documentKindForOutputSlug('living-will.docx')).toBe('advance_directive')
    expect(documentKindForOutputSlug('estate-plan-summary.docx')).toBe('other')
    expect(documentKindForOutputSlug('funding-instructions.docx')).toBe('other')
    expect(documentKindForOutputSlug('something-new.docx')).toBeNull()
  })

  it('maps a template-library id, and falls back to the generator’s title', () => {
    expect(documentKindForTemplate({ templateId: 'estate-revocable-trust', title: null })).toBe('trust')
    expect(documentKindForTemplate({ templateId: 'deed-quitclaim-individual', title: null })).toBe('deed')
    expect(documentKindForTemplate({ templateId: 'custom-123', title: 'Health Care Proxy' })).toBe('health_care_proxy')
    expect(documentKindForTemplate({ templateId: null, title: null })).toBeNull()
  })

  it('prefers the stored kind, guesses only where none was recorded, and leaves unsigned documents out', () => {
    const resolved = resolveDocumentKinds([
      { name: 'Smith_Pour-Over Will.docx', kind: 'will' },
      { name: 'Smith_Trust.docx', kind: 'trust' },
      { name: 'Smith_Trust Funding Plan.docx', kind: 'other' },
      { name: 'Smith_Health Care Proxy.docx', kind: null },
      { name: 'Scan 0042.pdf', kind: null },
    ])
    expect(resolved.kinds).toEqual(['will', 'trust', 'health_care_proxy'])
    expect(resolved.unmatched).toEqual(['Scan 0042.pdf'])
  })
})

describe('what the room needs', () => {
  const base = { matterName: 'Smith Estate Plan', clients: ['Pat Smith'], now: new Date('2026-10-05T12:00:00Z') }

  it('seats the client, two witnesses and a notary for a full plan, witnessed documents first', () => {
    const kit = buildSigningDayKit({
      ...base,
      kinds: ['trust', 'will', 'dpoa', 'health_care_proxy', 'hipaa_authorization', 'certificate_of_trust'],
      scheduledFor: '2026-10-09T18:00:00Z',
      location: '1329 Highland Avenue, Needham, MA 02492',
      notaryName: 'Dana Notary',
      healthCareAgentName: 'Sam Smith',
    })
    expect(kit.present.map(person => person.role)).toEqual(['Client', 'Witness 1', 'Witness 2', 'Notary public'])
    expect(kit.present[0].name).toBe('Pat Smith')
    expect(kit.present[3].name).toBe('Dana Notary')
    expect(kit.witnessesNeeded).toBe(2)
    expect(kit.notaryRequired).toBe(true)
    // Witnessed documents first, while the witnesses are in the room.
    expect(kit.documents.map(document => document.witnesses)).toEqual([2, 2, 2, 0, 0, 0])
    expect(kit.documents.map(document => document.order)).toEqual([1, 2, 3, 4, 5, 6])
    expect(kit.scheduledFor).toContain('October 9, 2026')
    expect(kit.witnessInstructions.some(line => line.includes('Sam Smith') && line.includes('may not witness'))).toBe(true)
    expect(kit.notaryInstructions.some(line => line.includes('Self-proving affidavit'))).toBe(true)
    expect(kit.afterSigning.some(line => line.includes('certified copies of the certificate of trust'))).toBe(true)
    expect(summariseSigningKit(kit)).toBe('6 documents to sign, 2 witnesses, a notary')
  })

  it('places a tab for every signer, witness and acknowledgment, naming the client where there is one', () => {
    const kit = buildSigningDayKit({ ...base, kinds: ['will', 'trust'] })
    const will = kit.documents.find(document => document.kind === 'will')!
    expect(will.tabs.map(tab => tab.label)).toEqual([
      'Sign: Pat Smith (testator)',
      'Witness 1',
      'Witness 2',
      'Self-proving affidavit: testator, both witnesses, notary',
    ])
    const trust = kit.documents.find(document => document.kind === 'trust')!
    expect(trust.tabs.map(tab => tab.label)).toEqual(['Sign: Pat Smith (settlor)', 'Sign: Pat Smith (trustee)', 'Notary acknowledgment'])
    expect(trust.tabs[1].where).toBe('Trustee acceptance line')
    // Two clients sign the same instruments in turn, so the role stands alone.
    const joint = buildSigningDayKit({ ...base, clients: ['Pat Smith', 'Sam Smith'], kinds: ['trust'] })
    expect(joint.documents[0].tabs[0].label).toBe('Sign: Settlor')
    expect(joint.present.filter(person => person.role === 'Client').map(person => person.name)).toEqual(['Pat Smith', 'Sam Smith'])
  })

  it('needs neither witnesses nor a notary for a HIPAA-only signing, and says so', () => {
    const kit = buildSigningDayKit({ ...base, kinds: ['hipaa_authorization'] })
    expect(kit.present.map(person => person.role)).toEqual(['Client'])
    expect(kit.witnessInstructions).toEqual(['No document being signed today requires witnesses.'])
    expect(kit.notaryInstructions).toEqual(['No document being signed today needs a notary.'])
    expect(kit.bring.some(line => line.includes('stamp'))).toBe(false)
    expect(summariseSigningKit(kit)).toBe('1 document to sign, no notary')
  })

  it('carries the recordings and the unplaced documents through', () => {
    const kit = buildSigningDayKit({ ...base, kinds: ['deed', 'homestead_declaration'], unmatchedDocuments: ['Scan 0042.pdf'] })
    expect(kit.recordings).toHaveLength(2)
    expect(kit.afterSigning.filter(line => line.startsWith('Record at the Registry'))).toHaveLength(2)
    expect(kit.unmatchedDocuments).toEqual(['Scan 0042.pdf'])
    expect(kit.documents.every(document => document.tabs.some(tab => tab.label === 'Notary acknowledgment'))).toBe(true)
  })
})

describe('the kit through the dial', () => {
  it('is a preparation with an undo, so it may run unattended up to Act', () => {
    const definition = getActionDefinition('signing.kit.prepare')
    expect(definition?.risk).toBe('prepare')
    expect(definition?.undo).toBeDefined()
    expect(autonomyCeilingForRisk('prepare')).toBe('act_silent')
    expect(ACTION_CATALOG['signing.kit.prepare']?.group).toBe('matters')
    expect(definition!.validate({ matterId: MATTER, scheduledFor: '2026-10-09T18:00:00Z' }, { id: 'u' }))
      .toEqual({ matterId: MATTER, scheduledFor: '2026-10-09T18:00:00.000Z' })
    expect(definition!.validate({ matterId: MATTER }, { id: 'u' })).toEqual({ matterId: MATTER, scheduledFor: null })
    expect(() => definition!.validate({ matterId: MATTER, scheduledFor: 'not a date' }, { id: 'u' })).toThrow('valid date')
    expect(() => definition!.validate({ scheduledFor: '2026-10-09' }, { id: 'u' })).toThrow('matter identifier')
  })

  it('keeps a record the attorney already opened, and undoes only what it created', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const block = source.slice(source.indexOf("key: 'signing.kit.prepare'"), source.indexOf("key: 'email.draft.compose'"))
    expect(block).toContain("loaded.ceremony?.status === 'scheduled' ? loaded.ceremony.id : null")
    expect(block).toContain('createdCeremony = true')
    expect(block).toContain("record.afterState?.createdCeremony === true")
    expect(block).toContain(".eq('executed', true)")
    expect(block).toContain('/signing-kit')
  })

  it('is proposed when a signing appointment is booked, keyed to the matter and the day', () => {
    const automation = fs.readFileSync('lib/appointments/automation.ts', 'utf8')
    expect(automation).toContain("input.type.key === 'signing_appointment'")
    expect(automation).toContain('delegateSigningKit({ matterId: input.matterId, scheduledFor: input.startIso ?? null')
    const book = fs.readFileSync('lib/appointments/book.ts', 'utf8')
    expect(book).toContain('startIso,\n    bookedByUserId:')
    const delegate = fs.readFileSync('lib/signing/delegateKit.ts', 'utf8')
    expect(delegate).toContain("actionKey: 'signing.kit.prepare'")
    expect(delegate).toContain("source: 'automation'")
    expect(delegate).toContain('applyAutonomy: true')
    expect(delegate).toContain('idempotencyKey: `signing-kit:${input.matterId}:${day}`')
  })

  it('is printable from the Signing view, and the generator records each document’s kind', () => {
    const panel = fs.readFileSync('app/admin/matters/[id]/tabs/signing/MatterSigningPanel.tsx', 'utf8')
    expect(panel).toContain('/signing-kit')
    const page = fs.readFileSync('app/admin/matters/[id]/signing-kit/page.tsx', 'utf8')
    expect(page).toContain('requireStaffPage()')
    expect(page).toContain('loadSigningKit(id)')
    const persist = fs.readFileSync('lib/drafting/persistGeneratedDocument.ts', 'utf8')
    expect(persist).toContain('document_kind: args.documentKind ?? null')
    // Code and migrations deploy in no guaranteed order: both the write and the read tolerate the column not existing yet.
    expect(persist).toContain("error?.code === '42703' || error?.code === 'PGRST204'")
    const repository = fs.readFileSync('lib/execution/repository.ts', 'utf8')
    expect(repository).toContain("documentQuery('matter_id, name')")
    const generated = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    expect(generated).toContain('document_kind: string | null')
    const draft = fs.readFileSync('app/api/admin/matters/[id]/draft/route.ts', 'utf8')
    expect(draft).toContain('documentKind: documentKindForOutputSlug(file.filename)')
    expect(draft).toContain("update({ document_kind: documentKind })")
    const migration = fs.readFileSync('supabase/migrations/20270108090000_matter_document_kind.sql', 'utf8')
    expect(migration).toContain('add column if not exists document_kind text')
    expect(migration).toContain("'parental_guardian_appointment', 'other'")
  })
})
