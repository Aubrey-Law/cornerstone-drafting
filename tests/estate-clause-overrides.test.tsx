/** @vitest-environment jsdom */

import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClauseOverridesPanel } from '@/app/admin/drafting/[matterId]/ClauseOverridesPanel'
import {
  isPublishedClauseOverrideEligible,
  parseDeleteOverrideRequest,
  parseOverrideRequest,
} from '@/app/api/admin/matters/[id]/estate-clause-overrides/route'
import {
  compatibleEstateDocumentTypesForTemplate,
  estateDocumentTypeForTemplate,
  referencedClauseKeys,
} from '@/lib/estateClauses/templateReferences'
import type { EstateDocumentType } from '@/lib/estateClauses/types'
import { getDocumentTemplateRegistry } from '@/lib/documentTemplates/registry'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))

function docx(parts: Record<string, string>) {
  const zip = new PizZip()
  for (const [name, xml] of Object.entries(parts)) zip.file(name, xml)
  return zip.generate({ type: 'nodebuffer' })
}

function response(body: unknown, ok = true, status = ok ? 200 : 409) {
  return { ok, status, json: async () => body } as Response
}

describe('estate clause template references', () => {
  it('joins split Word text runs across every Word XML part and returns sorted literal keys', () => {
    const template = docx({
      'word/document.xml': '<w:document><w:t>{{ include_</w:t><w:t>clause(&quot;will.pet_care&quot;) }}</w:t></w:document>',
      'word/header1.xml': '<w:hdr><w:t>{{ include_clause(&apos;will.guardian_nomination&apos;) }}</w:t></w:hdr>',
      'word/footer1.xml': '<w:ftr><w:t>{{ include_clause("will.pet_care") }}</w:t></w:ftr>',
      'custom.xml': '<x>{{ include_clause("ignored.custom_part") }}</x>',
    })

    expect(referencedClauseKeys(template)).toEqual([
      'will.guardian_nomination',
      'will.pet_care',
    ])
  })

  it('rejects dynamic clause-key expressions instead of treating them as auditable references', () => {
    const template = docx({
      'word/document.xml': '<w:document><w:t>{{ include_clause(clause_key) }}</w:t></w:document>',
    })

    expect(() => referencedClauseKeys(template)).toThrow(/literal stable clause key/i)
  })

  it('classifies testamentary trust wills as wills while preserving incapacity document types', () => {
    const will = { id: 'testamentary-trust-will', title: 'Will with Trust', template: 'templates/will.docx', output: 'will.docx' }
    expect(estateDocumentTypeForTemplate(will)).toBe('will')
    expect(compatibleEstateDocumentTypesForTemplate(will)).toEqual(['will', 'ancillary'])
    expect(estateDocumentTypeForTemplate({ id: 'living-will', title: 'Living Will', template: 'templates/living-will.docx', output: 'living-will.docx' })).toBe('health_care_directive')
    expect(estateDocumentTypeForTemplate({ id: 'hipaa', title: 'HIPAA Authorization', template: 'templates/hipaa.docx', output: 'hipaa.docx' })).toBe('hipaa_authorization')
  })

  it('parses every bundled estate template without accepting dynamic clause keys', () => {
    const references = new Set<string>()
    for (const template of getDocumentTemplateRegistry().filter(item => item.category === 'estate')) {
      for (const key of referencedClauseKeys(fs.readFileSync(path.join(process.cwd(), template.bundledPath)))) {
        references.add(key)
      }
    }
    expect(references).toContain('will.pet_care')
    expect(references).toContain('execution.self_proving_affidavit')
  })
})

describe('estate clause override request contracts', () => {
  it('admits only active current conditional publications with a referenced compatible document type', () => {
    const row = {
      clause_id: 'clause-id',
      current_revision_id: 'current-revision',
      estate_clauses: { clause_key: 'will.pet_care', title: 'Pet Care', document_types: ['will'] as EstateDocumentType[] },
      estate_clause_revisions: { revision_number: 3, condition_field: 'has_pet_care' },
    }
    expect(isPublishedClauseOverrideEligible(row, new Map([['will.pet_care', new Set<EstateDocumentType>(['will'])]]))).toBe(true)
    expect(isPublishedClauseOverrideEligible(row, new Map([['will.pet_care', new Set<EstateDocumentType>(['trust'])]]))).toBe(false)
    expect(isPublishedClauseOverrideEligible({
      ...row,
      estate_clause_revisions: { ...row.estate_clause_revisions, condition_field: null },
    }, new Map([['will.pet_care', new Set<EstateDocumentType>(['will'])]]))).toBe(false)
    expect(isPublishedClauseOverrideEligible(row, new Map())).toBe(false)
  })

  it('accepts only a stable key, supported action, and ten-character reason', () => {
    expect(parseOverrideRequest({
      clauseKey: 'will.pet_care',
      action: 'force_include',
      reason: 'Attorney reviewed this exception.',
    })).toEqual({
      clauseKey: 'will.pet_care',
      action: 'force_include',
      reason: 'Attorney reviewed this exception.',
    })

    expect(() => parseOverrideRequest({
      clauseKey: 'will.pet_care',
      action: 'force_omit',
      reason: 'too short',
    })).toThrow(/at least 10 characters/i)
  })

  it('rejects manual text, historical revision ids, and extra DELETE fields', () => {
    expect(() => parseOverrideRequest({
      clauseKey: 'will.pet_care',
      action: 'force_include',
      reason: 'Attorney reviewed this exception.',
      clauseText: 'Insert arbitrary text',
    })).toThrow(/exactly/i)
    expect(() => parseOverrideRequest({
      clauseKey: 'will.pet_care',
      action: 'force_include',
      reason: 'Attorney reviewed this exception.',
      revisionId: 'historical-revision',
    })).toThrow(/exactly/i)
    expect(() => parseDeleteOverrideRequest({ clauseKey: 'will.pet_care', revisionId: 'old' })).toThrow(/exactly/i)
  })
})

describe('matter clause override panel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      matterId: 'canonical-matter',
      clauses: [{
        clauseKey: 'will.pet_care',
        title: 'Pet Care',
        documentTypes: ['will'],
        conditionField: 'has_pet_care',
        currentRevisionId: 'current-revision',
        revisionNumber: 4,
        defaultOutcome: 'omit',
        override: null,
      }],
    })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows default selection and current publication, then invalidates generation state after save', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response({
        matterId: 'canonical-matter',
        clauses: [{
          clauseKey: 'will.pet_care', title: 'Pet Care', documentTypes: ['will'],
          conditionField: 'has_pet_care', currentRevisionId: 'current-revision', revisionNumber: 4,
          defaultOutcome: 'omit', override: null,
        }],
      }))
      .mockResolvedValueOnce(response({ override: { id: 'override-id' } }))
      .mockResolvedValueOnce(response({
        matterId: 'canonical-matter',
        clauses: [{
          clauseKey: 'will.pet_care', title: 'Pet Care', documentTypes: ['will'],
          conditionField: 'has_pet_care', currentRevisionId: 'current-revision', revisionNumber: 4,
          defaultOutcome: 'omit',
          override: { id: 'override-id', action: 'force_include', reason: 'Client requested pet protections.', actorId: 'attorney' },
        }],
      }))
    const onMutated = vi.fn()
    const user = userEvent.setup()
    render(<ClauseOverridesPanel matterId="matter-number" onMutated={onMutated} />)

    expect(await screen.findByText('Default: omit')).toBeTruthy()
    expect(screen.getByText('Published revision 4')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Override action for Pet Care'), 'force_include')
    await user.type(screen.getByLabelText('Reason for Pet Care'), 'Client requested pet protections.')
    await user.click(screen.getByRole('button', { name: 'Save Pet Care override' }))

    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/admin/matters/matter-number/estate-clause-overrides',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          clauseKey: 'will.pet_care',
          action: 'force_include',
          reason: 'Client requested pet protections.',
        }),
      }),
    )
  })

  it('does not offer manual clause text or historical revision selection', async () => {
    render(<ClauseOverridesPanel matterId="matter-number" onMutated={() => undefined} />)
    await screen.findByText('Pet Care')
    expect(screen.queryByLabelText(/clause text/i)).toBeNull()
    expect(screen.queryByLabelText(/revision/i)).toBeNull()
  })

  it('deletes by stable key only and invalidates generation state', async () => {
    const existing = {
      matterId: 'canonical-matter',
      clauses: [{
        clauseKey: 'will.pet_care', title: 'Pet Care', documentTypes: ['will'],
        conditionField: 'has_pet_care', currentRevisionId: 'current-revision', revisionNumber: 4,
        defaultOutcome: 'include',
        override: { id: 'override-id', action: 'force_omit', reason: 'Client has no pets to protect.', actorId: 'attorney' },
      }],
    }
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response(existing))
      .mockResolvedValueOnce(response({ deleted: true, clauseKey: 'will.pet_care' }))
      .mockResolvedValueOnce(response({ ...existing, clauses: [{ ...existing.clauses[0], override: null }] }))
    const onMutated = vi.fn()
    const user = userEvent.setup()
    render(<ClauseOverridesPanel matterId="matter-number" onMutated={onMutated} />)

    await user.click(await screen.findByRole('button', { name: 'Remove Pet Care override' }))
    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/admin/matters/matter-number/estate-clause-overrides',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ clauseKey: 'will.pet_care' }) }),
    )
  })

  it('wires successful mutations to clear the GenerateStep preflight and derived readiness', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/drafting/[matterId]/GenerateStep.tsx'), 'utf8')
    const handler = source.slice(source.indexOf('const handleClauseOverridesMutated'), source.indexOf('const handlePreflight'))
    expect(handler).toContain('setPreflight(null)')
    expect(handler).toContain('setSelectedDocs(new Set())')
    expect(source).toContain('<ClauseOverridesPanel matterId={matterId} onMutated={handleClauseOverridesMutated} />')
  })
})
