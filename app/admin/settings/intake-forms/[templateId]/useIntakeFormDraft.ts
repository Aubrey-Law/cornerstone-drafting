'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import type { IntakeFormEditorSnapshot, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
import { compileIntakeForm, type IntakeFormDiagnostic } from '@/lib/intake/forms/compiler'
import { createBlankDefinition, definitionFingerprint } from '@/lib/intake/forms/editorState'
import { parseIntakeFormDefinition } from '@/lib/intake/forms/schema'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

export type IntakeFormSaveStatus = 'clean' | 'dirty' | 'saving' | 'error' | 'conflict'
const diagnosticSchema = z.object({ path: z.string(), message: z.string() })
const diagnosticsSchema = z.array(diagnosticSchema)
const templateSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), description: z.string().nullable(), archived_at: z.string().nullable(),
  created_by: z.string(), created_at: z.string(), updated_at: z.string(),
}).strict()
const versionSchema = z.object({
  id: z.string(), template_id: z.string(), version: z.number().int().positive(), status: z.enum(['draft', 'published', 'retired']),
  definition: z.unknown(), definition_hash: z.string().regex(/^[0-9a-f]{64}$/), lock_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  created_by: z.string(), created_at: z.string(), updated_at: z.string(), published_at: z.string().nullable(), published_by: z.string().nullable(),
}).strict()
const auditSchema = z.object({
  id: z.string(), template_id: z.string(), version_id: z.string().nullable(), version_number: z.number().int().positive().nullable(),
  action: z.enum(['create', 'save', 'create_next_draft', 'publish', 'retire', 'archive', 'restore', 'duplicate', 'discard']),
  actor_id: z.string(), occurred_at: z.string(), metadata: z.record(z.unknown()),
}).strict()
const invalidResponse = () => new Error('The server returned an invalid intake form response. Your local changes are preserved; retry or reload latest.')
class IntakeFormRequestError extends Error {
  constructor(readonly status: number, readonly body: unknown) { super('Unable to complete the intake form request') }
}
async function responseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new IntakeFormRequestError(response.status, body)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidResponse()
  return body
}
function parseVersion(raw: unknown, template: IntakeFormEditorSnapshot['template'], status?: IntakeFormVersionRow['status'], id?: string): IntakeFormVersionRow {
  const parsed = versionSchema.safeParse(raw)
  if (!parsed.success) throw invalidResponse()
  const definition = parseIntakeFormDefinition(parsed.data.definition)
  if (!definition.success || parsed.data.template_id !== template.id || definition.data.key !== template.key ||
    (status && parsed.data.status !== status) || (id && parsed.data.id !== id)) throw invalidResponse()
  return { ...parsed.data, definition: definition.data }
}
function parseSnapshot(raw: unknown, expected: IntakeFormEditorSnapshot['template']): IntakeFormEditorSnapshot {
  const envelope = z.object({ template: templateSchema, draft: z.unknown(), versions: z.array(z.unknown()), auditEvents: z.array(auditSchema) }).strict().safeParse(raw)
  if (!envelope.success || envelope.data.template.id !== expected.id || envelope.data.template.key !== expected.key) throw invalidResponse()
  const { template } = envelope.data
  const versions = envelope.data.versions.map(value => parseVersion(value, template))
  const draft = envelope.data.draft === null ? null : parseVersion(envelope.data.draft, template, 'draft')
  const drafts = versions.filter(version => version.status === 'draft')
  if (new Set(versions.map(version => version.id)).size !== versions.length || drafts.length !== (draft ? 1 : 0) ||
    (draft && JSON.stringify(drafts[0]) !== JSON.stringify(draft)) || envelope.data.auditEvents.some(event => event.template_id !== template.id)) throw invalidResponse()
  // JSON came through response.json; the schema above validates all event metadata before adoption.
  return { template, versions, draft, auditEvents: envelope.data.auditEvents as IntakeFormEditorSnapshot['auditEvents'] }
}
function definitionFor(snapshot: IntakeFormEditorSnapshot) {
  return snapshot.draft?.definition ?? [...snapshot.versions].sort((a, b) => b.version - a.version)[0]?.definition ??
    createBlankDefinition({ key: snapshot.template.key, title: snapshot.template.name })
}

export function useIntakeFormDraft(initialSnapshot: IntakeFormEditorSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [localDefinition, setLocalDefinition] = useState(() => definitionFor(initialSnapshot))
  const [savedDefinition, setSavedDefinition] = useState(() => definitionFor(initialSnapshot))
  const [requestStatus, setRequestStatus] = useState<'idle' | 'saving' | 'error' | 'conflict'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [serverDiagnostics, setServerDiagnostics] = useState<IntakeFormDiagnostic[]>([])
  const inFlight = useRef(false)
  const allowDeparture = useRef(false)
  const dirty = definitionFingerprint(localDefinition) !== definitionFingerprint(savedDefinition)
  const saveStatus: IntakeFormSaveStatus = requestStatus === 'idle' ? dirty ? 'dirty' : 'clean' : requestStatus
  const busy = requestStatus === 'saving'
  const version = snapshot.draft ?? [...snapshot.versions].sort((a, b) => b.version - a.version)[0] ?? null
  const readOnly = !snapshot.draft || Boolean(snapshot.template.archived_at) || busy
  const diagnostics = useMemo(() => {
    const unique = new Map<string, IntakeFormDiagnostic>()
    for (const audience of ['client', 'staff'] as const) {
      const result = compileIntakeForm(localDefinition, audience)
      if (!result.success) for (const diagnostic of result.errors) unique.set(JSON.stringify([diagnostic.path, diagnostic.message]), diagnostic)
    }
    for (const diagnostic of serverDiagnostics) unique.set(JSON.stringify([diagnostic.path, diagnostic.message]), diagnostic)
    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }) || a.message.localeCompare(b.message, 'en'))
  }, [localDefinition, serverDiagnostics])
  const canPublish = Boolean(snapshot.draft && !snapshot.template.archived_at && saveStatus === 'clean' && !diagnostics.length)
  const unsafe = dirty || requestStatus !== 'idle'

  useEffect(() => {
    if (!unsafe) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowDeparture.current) return
      event.preventDefault(); event.returnValue = ''
    }
    const click = (event: MouseEvent) => {
      if (allowDeparture.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return
      if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.origin === window.location.origin) return
      if (!window.confirm('You have unsaved intake form changes. Leave without saving them?')) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true) }
  }, [unsafe])

  function changeDefinition(next: IntakeFormDefinition) {
    if (!readOnly && !inFlight.current) { setLocalDefinition(next); setServerDiagnostics([]); setNotice(null) }
  }
  function replaceSnapshot(next: IntakeFormEditorSnapshot, nextDiagnostics: IntakeFormDiagnostic[] = []) {
    setSnapshot(next); const definition = definitionFor(next)
    setLocalDefinition(definition); setSavedDefinition(definition); setServerDiagnostics(nextDiagnostics)
    setError(null); setNotice(null); setRequestStatus('idle')
  }
  function replaceVersion(next: IntakeFormVersionRow, nextDiagnostics: IntakeFormDiagnostic[] = []) {
    const versions = [next, ...snapshot.versions.filter(value => value.id !== next.id)]
    replaceSnapshot({ ...snapshot, versions, draft: next.status === 'draft' ? next : null }, nextDiagnostics)
  }
  async function request(action: () => Promise<void>) {
    if (inFlight.current) return false
    inFlight.current = true; setRequestStatus('saving'); setError(null); setNotice(null)
    try { await action(); return true } catch (failure) {
      const api = failure instanceof IntakeFormRequestError ? failure : null
      const body = z.object({ error: z.string().optional(), diagnostics: diagnosticsSchema.optional() }).safeParse(api?.body)
      setRequestStatus(api?.status === 409 || requestStatus === 'conflict' ? 'conflict' : 'error')
      if (body.success && body.data.diagnostics) setServerDiagnostics(body.data.diagnostics)
      setError(api?.status === 409 ? 'This draft changed elsewhere. Your local changes are preserved. Copy your local definition or reload latest.' :
        body.success && body.data.error ? body.data.error : failure instanceof Error ? failure.message : 'Unable to complete this request. Please retry.')
      return false
    } finally { inFlight.current = false }
  }
  const baseUrl = `/api/admin/settings/intake-forms/${encodeURIComponent(snapshot.template.id)}`
  async function jsonRequest(path: string, method: string, body?: unknown) {
    return responseJson(await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? { cache: 'no-store' as const } : { body: JSON.stringify(body) }) }))
  }
  async function saveDraft() {
    const draft = snapshot.draft
    if (!draft || readOnly || requestStatus === 'conflict') return
    await request(async () => {
      const envelope = z.object({ draft: z.unknown(), diagnostics: diagnosticsSchema }).strict().safeParse(await jsonRequest('/draft', 'PUT', { versionId: draft.id, expectedLockVersion: draft.lock_version, definition: localDefinition }))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.draft, snapshot.template, 'draft', draft.id)
      if (next.version !== draft.version || next.lock_version <= draft.lock_version) throw invalidResponse()
      replaceVersion(next, envelope.data.diagnostics)
    })
  }
  async function reloadLatest() { return request(async () => replaceSnapshot(parseSnapshot(await jsonRequest('', 'GET'), snapshot.template))) }
  async function copyLocalDefinition() {
    try {
      const parsed = parseIntakeFormDefinition(localDefinition)
      if (!parsed.success) throw new Error('Resolve invalid form values before exporting this definition.')
      const json = JSON.stringify(JSON.parse(definitionFingerprint(parsed.data)), null, 2)
      try { await navigator.clipboard.writeText(json); setNotice('Local definition copied.') } catch {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const anchor = document.createElement('a')
        try { anchor.href = url; anchor.download = `${snapshot.template.key}-unsaved-intake-form.json`; document.body.append(anchor); anchor.click(); setNotice('Local definition downloaded.') }
        finally { anchor.remove(); URL.revokeObjectURL(url) }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to export this definition.') }
  }
  async function publishDraft() {
    const draft = snapshot.draft
    if (!draft || !canPublish) return
    await request(async () => {
      const envelope = z.object({ version: z.unknown() }).strict().safeParse(await jsonRequest('/publish', 'POST', { versionId: draft.id, expectedLockVersion: draft.lock_version, expectedDefinitionHash: draft.definition_hash }))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.version, snapshot.template, 'published', draft.id)
      if (next.version !== draft.version || next.definition_hash !== draft.definition_hash || definitionFingerprint(next.definition) !== definitionFingerprint(savedDefinition)) throw invalidResponse()
      replaceVersion(next)
    })
  }
  async function discardDraft() {
    const draft = snapshot.draft
    if (!draft || busy || snapshot.template.archived_at) return
    return request(async () => {
      const envelope = z.object({ draft: z.unknown() }).strict().safeParse(await jsonRequest('/draft', 'DELETE', { versionId: draft.id, expectedLockVersion: draft.lock_version }))
      if (!envelope.success) throw invalidResponse()
      const removed = parseVersion(envelope.data.draft, snapshot.template, 'draft', draft.id)
      if (removed.lock_version !== draft.lock_version || removed.version !== draft.version) throw invalidResponse()
      const versions = snapshot.versions.filter(value => value.id !== draft.id)
      replaceSnapshot({ ...snapshot, draft: null, versions })
      if (!versions.length) { allowDeparture.current = true; window.location.assign('/admin/settings/intake-forms') }
    })
  }
  async function retireVersion() {
    if (!version || version.status !== 'published' || busy || dirty || requestStatus === 'conflict') return
    await request(async () => {
      const envelope = z.object({ version: z.unknown() }).strict().safeParse(await jsonRequest(`/versions/${encodeURIComponent(version.id)}/retire`, 'POST', {}))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.version, snapshot.template, 'retired', version.id)
      if (next.version !== version.version || next.definition_hash !== version.definition_hash || definitionFingerprint(next.definition) !== definitionFingerprint(savedDefinition)) throw invalidResponse()
      replaceVersion(next)
    })
  }
  async function createNextDraft() {
    if (!version || snapshot.draft || snapshot.template.archived_at || busy || dirty || requestStatus === 'conflict') return
    await request(async () => {
      const envelope = z.object({ draft: z.unknown(), diagnostics: diagnosticsSchema }).strict().safeParse(await jsonRequest('/draft', 'POST', { sourceVersionId: version.id }))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.draft, snapshot.template, 'draft')
      if (next.version <= version.version || snapshot.versions.some(value => value.id === next.id)) throw invalidResponse()
      replaceVersion(next, envelope.data.diagnostics)
    })
  }
  return { snapshot, version, localDefinition, changeDefinition, dirty, saveStatus, busy, readOnly, diagnostics, canPublish, error, notice,
    saveDraft, reloadLatest, copyLocalDefinition, publishDraft, discardDraft, retireVersion, createNextDraft }
}
