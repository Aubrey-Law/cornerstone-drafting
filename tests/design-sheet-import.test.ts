import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  coerceDesignSheetImport,
  getDesignSheetDocxValidationError,
  getDesignSheetImportTextValidationError,
  buildDesignSheetImportPreview,
  MAX_DESIGN_SHEET_DOCX_BYTES,
  MAX_DESIGN_SHEET_IMPORT_TEXT_LENGTH,
} from '@/lib/designSheetImport/shared'
import {
  buildDesignSheetPersistencePayload,
  inflateDesignSheetRow,
} from '@/lib/designSheetPersistence'

describe('design sheet import validation', () => {
  it('validates import text length', () => {
    expect(getDesignSheetImportTextValidationError('')).toBe('text required')
    expect(getDesignSheetImportTextValidationError('short')).toBe('text too short (20 char min)')
    expect(getDesignSheetImportTextValidationError('x'.repeat(MAX_DESIGN_SHEET_IMPORT_TEXT_LENGTH + 1)))
      .toBe('text too long (60k char max)')
    expect(getDesignSheetImportTextValidationError('This design sheet text is long enough.')).toBeNull()
  })

  it('accepts DOCX files by extension or MIME type and rejects invalid files', () => {
    const docx = new File(['x'], 'design-sheet.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(getDesignSheetDocxValidationError(docx)).toBeNull()
    expect(getDesignSheetDocxValidationError(null)).toBe('No file provided')
    expect(getDesignSheetDocxValidationError(new File(['x'], 'design-sheet.pdf', { type: 'application/pdf' })))
      .toBe('Only Word .docx documents are supported')
    expect(getDesignSheetDocxValidationError(new File(['x'.repeat(MAX_DESIGN_SHEET_DOCX_BYTES + 1)], 'large.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }))).toBe('Word document is too large (10 MB max)')
  })
})

describe('design sheet import route source', () => {
  it('DOCX route validates, extracts, delegates, and requires admin auth', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/design-sheet/import-docx/route.ts'),
      'utf8',
    )

    expect(source).toContain('requireAdmin')
    expect(source).toContain('getDesignSheetDocxValidationError')
    expect(source).toContain('extractDesignSheetDocxText')
    expect(source).toContain('parseDesignSheetImportText')
    expect(source).not.toContain(".from('design_sheets').update")
  })

  it('text route validates and delegates without writing design sheets', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/design-sheet/import-text/route.ts'),
      'utf8',
    )

    expect(source).toContain('requireAdmin')
    expect(source).toContain('parseDesignSheetImportText')
    expect(source).not.toContain(".from('design_sheets').update")
  })

  it('server helper resolves LLM config and completes import via shared layer', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/designSheetImport/server.ts'),
      'utf8',
    )

    expect(source).toContain('resolveLlmConfig')
    expect(source).toContain('completeLlmText')
    expect(source).not.toContain('getAnthropicClient')
    expect(source).not.toContain('claude-sonnet-4-20250514')
  })

  it('design sheet contact picker can update saved contacts scoped to the matter', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/[id]/design-sheet/contacts/route.ts'),
      'utf8',
    )
    const picker = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/ContactPicker.tsx'),
      'utf8',
    )
    const shell = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )

    expect(route).toContain('export async function PATCH')
    expect(route).toContain(".eq('client_intake_id', matter.client_intake_id)")
    expect(route).toContain('preferred_pronoun')
    expect(picker).toContain('Edit Contact')
    expect(picker).toContain('onUpdateContact')
    expect(picker).toContain('isRealContact')
    expect(shell).toContain('handleUpdateContact')
  })
})

describe('coerceDesignSheetImport', () => {
  it('keeps recognized fields and discards unknown or empty values', () => {
    const proposed = coerceDesignSheetImport({
      client_name: 'Jane Doe',
      client_pronouns: 'she/her',
      inheritance_structure: 'trust-protection',
      trust_name: 'The Jane Doe Revocable Trust',
      restatement: true,
      goals_notes: '',
      unknown_field: 'discard me',
      assets: [
        { id: 'ignored', category: 'real_property', description: 'Home', estimated_value: 750000, institution: '', notes: '' },
        'bad asset',
      ],
      children: [
        { name: 'Alex Doe', dob: '2012-01-01', relationship: 'biological', is_minor: true },
        { name: '', dob: '', relationship: 'bad', is_minor: false },
      ],
    })

    expect(proposed).toEqual({
      client_name: 'Jane Doe',
      client_pronouns: 'she/her',
      trust_name: 'The Jane Doe Revocable Trust',
      restatement: true,
      assets: [
        { id: expect.any(String), category: 'real_property', description: 'Home', institution: '', estimated_value: 750000, notes: '' },
      ],
      children: [
        { name: 'Alex Doe', dob: '2012-01-01', relationship: 'biological', is_minor: true },
      ],
    })
  })

  it('discards empty numeric strings', () => {
    expect(coerceDesignSheetImport({
      distribution_age: '',
      stagger_age_1: '   ',
    })).toEqual({})
  })

  it('discards empty JSON values', () => {
    expect(coerceDesignSheetImport({
      pet_care_details: {},
      specific_bequests: [],
    })).toEqual({})
  })
})

describe('buildDesignSheetImportPreview', () => {
  it('omits empty proposed values and selects empty-field fills by default', () => {
    const preview = buildDesignSheetImportPreview({
      currentSheet: {
        client_name: '',
        trust_name: 'Existing Trust',
        goals_notes: null,
      },
      proposed: {
        client_name: 'Jane Doe',
        trust_name: 'New Trust Name',
        goals_notes: '',
      },
    })

    expect(preview).toHaveLength(2)
    expect(preview[0]).toMatchObject({
      field: 'client_name',
      label: 'Client name',
      section: 'Personal',
      currentDisplay: '-',
      proposedDisplay: 'Jane Doe',
      selected: true,
      replacement: false,
    })
    expect(preview[1]).toMatchObject({
      field: 'trust_name',
      section: 'Trust',
      currentDisplay: 'Existing Trust',
      proposedDisplay: 'New Trust Name',
      selected: false,
      replacement: true,
    })
  })

  it('flags structured value changes as replacements even when display text matches', () => {
    const preview = buildDesignSheetImportPreview({
      currentSheet: {
        children: [
          { name: 'Alex Doe', dob: '2012-01-01', relationship: 'biological', is_minor: true },
        ],
      },
      proposed: {
        children: [
          { name: 'Alex Doe', dob: '2010-01-01', relationship: 'biological', is_minor: false },
        ],
      },
    })

    expect(preview).toHaveLength(1)
    expect(preview[0]).toMatchObject({
      field: 'children',
      replacement: true,
      selected: false,
      currentDisplay: 'Alex Doe',
      proposedDisplay: 'Alex Doe',
    })
  })
})

describe('design sheet persistence import safety', () => {
  it('keeps existing decisions when saving an accepted import against a full sheet', () => {
    const currentSheet = inflateDesignSheetRow({
      id: 'sheet-1',
      matter_id: 'matter-1',
      version: 1,
      status: 'draft',
      trust_name: 'Existing Trust',
      decisions: {
        client_name: 'Existing Client',
        children: [{ name: 'Alex Doe', dob: null, relationship: 'biological', is_minor: true }],
        drafting_notes: 'Keep these notes',
      },
    })

    const payload = buildDesignSheetPersistencePayload({
      ...currentSheet,
      client_name: 'Jane Doe',
    })

    expect(payload).toMatchObject({
      trust_name: 'Existing Trust',
      client_name: 'Jane Doe',
      children: [{ name: 'Alex Doe', dob: null, relationship: 'biological', is_minor: true }],
      drafting_notes: 'Keep these notes',
    })
    // Writable columns are stripped out of decisions on save.
    expect((payload.decisions as Record<string, unknown>).drafting_notes).toBeUndefined()
    expect((payload.decisions as Record<string, unknown>).client_name).toBeUndefined()
  })

  it('stores lite-missing template fields in decisions (not as unknown columns)', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      hipaa_psychotherapy_notes: 'authorize',
      dpoa_coagent_manner: 'independently',
      pour_over_alternate_disposition: 'named',
      temporary_guardian_slots: [{ id: 'tg-1', contact_id: 'c-1', is_co: false, order: 0 }],
    } as unknown as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload.hipaa_psychotherapy_notes).toBeUndefined()
    expect(payload.dpoa_coagent_manner).toBeUndefined()
    expect(payload.pour_over_alternate_disposition).toBeUndefined()
    expect(payload.temporary_guardian_slots).toEqual([
      { id: 'tg-1', contact_id: 'c-1', is_co: false, order: 0 },
    ])
    expect(payload.decisions).toMatchObject({
      hipaa_psychotherapy_notes: 'authorize',
      dpoa_coagent_manner: 'independently',
      pour_over_alternate_disposition: 'named',
    })
  })

  it('normalizes non-ISO date strings before writing date columns', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      notary_commission_expiration: '07/15/2027',
      signing_date: '',
    } as unknown as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload.notary_commission_expiration).toBe('2027-07-15')
    expect(payload.signing_date).toBeNull()
  })

  it('persists client pronouns as a writable design-sheet column (#292 re-added them)', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      client_pronouns: 'she/her',
    } as unknown as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload).toEqual({
      client_name: 'Jane Doe',
      client_pronouns: 'she/her',
      decisions: {},
    })
  })

  it('persists excluded-guardian fields as writable columns (required for new-matter seed)', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      excluded_guardian_flag: true,
      excluded_guardian_name: 'John Smith',
    } as unknown as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload).toMatchObject({
      client_name: 'Jane Doe',
      excluded_guardian_flag: true,
      excluded_guardian_name: 'John Smith',
      decisions: {},
    })
  })

  it('does not persist legacy inheritance-structure values', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      inheritance_structure: 'trust-protection',
    } as unknown as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    expect(payload).toEqual({
      client_name: 'Jane Doe',
      decisions: {},
    })
  })

  it('inflates flexible decisions over stale non-writable row values', () => {
    const inflated = inflateDesignSheetRow({
      id: 'sheet-1',
      client_name: 'Stale Column Client',
      trust_name: 'Column Trust',
      decisions: {
        client_name: 'Current Decision Client',
        trust_name: 'Decision Trust',
      },
    })

    expect(inflated?.client_name).toBe('Stale Column Client')
    expect(inflated?.trust_name).toBe('Column Trust')
  })
})

describe('legacy design-sheet pronoun migration', () => {
  it('copies historical design-sheet pronouns to intake before dropping the column', () => {
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations_archive/portal')
    const migration = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find(source => source.includes('drop column if exists client_pronouns'))

    expect(migration).toBeDefined()
    expect(migration).toContain('update public.client_intake')
    expect(migration).toContain('preferred_pronoun')
    expect(migration).toContain('public.design_sheets')
    expect(migration).toContain('drop column if exists client_pronouns')
  })
})

describe('legacy inheritance-structure migration', () => {
  it('preserves local legacy values before dropping the retired column', () => {
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations_archive/portal')
    const migration = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find(source => source.includes('drop column if exists inheritance_structure'))

    expect(migration).toBeDefined()
    expect(migration).toContain('legacy_inheritance_structure')
    expect(migration).toContain('public.design_sheets')
    expect(migration).toContain('drop column if exists inheritance_structure')
  })
})

describe('design sheet import UI source', () => {
  it('shared dialog posts DOCX imports and saves accepted fields with current sheet context', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/design-sheet/DesignSheetImportDialog.tsx'),
      'utf8',
    )

    expect(source).toContain('import-docx')
    expect(source).toContain('Accept selected')
    expect(source).toContain('acceptedPatch')
    expect(source).toContain('currentSheet')
    expect(source).toContain('sheet: acceptedPatch')
    expect(source).not.toContain('{ ...currentSheet, ...acceptedPatch }')
    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain('Only Word .docx documents are supported')
  })

  it('DesignSheetPage renders the shared import dialog and updates local sheet state after accept', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )

    expect(source).toContain('DesignSheetImportDialog')
    expect(source).toContain('handleImportedDesignSheetFields')
    expect(source).toContain('onAccepted={handleImportedDesignSheetFields}')
  })

  it('keeps the import action visible in the embedded drafting workspace', () => {
    const toolbar = fs.readFileSync(
      path.join(process.cwd(), 'components/guided/DesignToolbarActions.tsx'),
      'utf8',
    )
    const shell = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )

    expect(toolbar).toContain('onImport')
    expect(toolbar).toContain('Import')
    expect(shell).toContain('setImportDialogOpen(true)')
    expect(shell).toContain('embedded')
  })

  it('lets the embedded design sheet use a constrained scroll viewport in the drafting workspace', () => {
    const workspace = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'),
      'utf8',
    )
    const shell = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )

    expect(workspace).toContain("step === 'design' ? 'overflow-hidden' : 'overflow-y-auto'")
    expect(workspace).toContain('min-h-0 flex-1 overflow-hidden')
    expect(shell).toContain('embedded')
  })
})
