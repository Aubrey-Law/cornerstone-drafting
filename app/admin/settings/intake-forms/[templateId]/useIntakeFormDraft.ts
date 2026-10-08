'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import type { IntakeFormEditorSnapshot, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
import { compileIntakeForm, type IntakeFormDiagnostic } from '@/lib/intake/forms/compiler'
import { createBlankDefinition, definitionFingerprint } from '@/lib/intake/forms/editorState'
import { parseIntakeFormDefinition } from '@/lib/intake/forms/schema'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'
import { SETTINGS_NAVIGATION_EVENT, type SettingsNavigationRequest } from '../../navigation'
import { parseSnapshot, parseVersion, invalidResponse } from '@/lib/intake/forms/responseParsing'

export type IntakeFormSaveStatus = 'clean' | 'dirty' | 'saving' | 'error' | 'conflict'
const diagnosticSchema = z.object({ path: z.string(), message: z.string() })
const diagnosticsSchema = z.array(diagnosticSchema)
class IntakeFormRequestError extends Error {
  constructor(readonly status: number, readonly body: unknown) { super('Unable to complete the intake form request') }
}
async function responseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new IntakeFormRequestError(response.status, body)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidResponse()
  return body
}
function definitionFor(snapshot: IntakeFormEditorSnapshot) {
  return snapshot.draft?.definition ?? [...snapshot.versions].sort((a, b) => b.version - a.version)[0]?.definition ??
    createBlankDefinition({ key: snapshot.template.key, title: snapshot.template.name })
}

export function useIntakeFormDraft(initialSnapshot: IntakeFormEditorSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [localDefinition, setLocalDefinition] = useState(() => definitionFor(initialSnapshot))
  const [savedDefinition, setSavedDefinition] = useState(() => definitionFor(initialSnapshot))
  const [requestStatus, setRequestStatus] = useState<'idle' | 'saving' | 'error' | 'conflict'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [serverDiagnostics, setServerDiagnostics] = useState<IntakeFormDiagnostic[]>([])
  const inFlight = useRef(false)
  const allowDeparture = useRef(false)
  const departureAction = useRef<(() => void) | null>(null)
  const departureTrigger = useRef<HTMLElement | null>(null)
  const [confirmingDeparture, setConfirmingDeparture] = useState(false)
  const dirty = definitionFingerprint(localDefinition) !== definitionFingerprint(savedDefinition)
  const saveStatus: IntakeFormSaveStatus = requestStatus === 'idle' ? dirty ? 'dirty' : 'clean' : requestStatus
  const busy = requestStatus === 'saving'
  const version = snapshot.versions.find(value => value.id === selectedVersionId) ?? snapshot.draft ?? [...snapshot.versions].sort((a, b) => b.version - a.version)[0] ?? null
  const viewingDraft = Boolean(snapshot.draft && version?.id === snapshot.draft.id)
  const displayedDefinition = !viewingDraft && version ? version.definition : localDefinition
  const readOnly = !viewingDraft || Boolean(snapshot.template.archived_at) || busy
  const diagnostics = useMemo(() => {
    const unique = new Map<string, IntakeFormDiagnostic>()
    for (const audience of ['client', 'staff'] as const) {
      const result = compileIntakeForm(displayedDefinition, audience)
      if (!result.success) for (const diagnostic of result.errors) unique.set(JSON.stringify([diagnostic.path, diagnostic.message]), diagnostic)
    }
    if (viewingDraft) for (const diagnostic of serverDiagnostics) unique.set(JSON.stringify([diagnostic.path, diagnostic.message]), diagnostic)
    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }) || a.message.localeCompare(b.message, 'en'))
  }, [displayedDefinition, viewingDraft, serverDiagnostics])
  const canPublish = Boolean(viewingDraft && !snapshot.template.archived_at && saveStatus === 'clean' && !diagnostics.length)
  const unsafe = dirty || requestStatus !== 'idle'

  useEffect(() => {
    // Next may restore this editor through an Activity boundary with refs intact.
    // A prior confirmed departure authorizes only that departure, never the next.
    allowDeparture.current = false
    const samePage = (href: string) => {
      const destination = new URL(href, window.location.href)
      return destination.pathname === window.location.pathname && destination.search === window.location.search && destination.origin === window.location.origin
    }
    const askToLeave = (proceed: () => void, trigger: HTMLElement | null) => {
      if (departureAction.current) return
      departureAction.current = proceed
      departureTrigger.current = trigger
      setConfirmingDeparture(true)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsafe || allowDeparture.current) return
      event.preventDefault(); event.returnValue = ''
    }
    const click = (event: MouseEvent) => {
      if (!unsafe || allowDeparture.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return
      if (samePage(destination.href)) return
      event.preventDefault(); event.stopPropagation()
      askToLeave(() => window.location.assign(destination.href), anchor)
    }
    const imperative = (event: Event) => {
      const { destination, proceed, trigger } = (event as CustomEvent<SettingsNavigationRequest>).detail
      if (!unsafe || allowDeparture.current || samePage(destination)) return
      event.preventDefault(); askToLeave(proceed, trigger)
    }
    // Cancel traversals before Next observes popstate. No synthetic history entries,
    // URL changes, or replay loops are needed in browsers with the Navigation API.
    const navigation = (window as unknown as { navigation?: EventTarget & { traverseTo: (key: string) => unknown } }).navigation
    const navigate = (event: Event) => {
      const traversal = event as Event & { navigationType: string; destination: { url: string; key: string; sameDocument: boolean } }
      if (!unsafe || allowDeparture.current || traversal.navigationType !== 'traverse' || !event.cancelable ||
        !traversal.destination.sameDocument || samePage(traversal.destination.url)) return
      event.preventDefault()
      askToLeave(() => navigation?.traverseTo(traversal.destination.key), document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }
    // Older browsers: stamp existing app history state, preserving the router's
    // own state. Restore a cancelled traversal before showing the same dialog.
    const marker = '__cornerstoneIntakeHistoryIndex'
    const originalPush = window.history.pushState
    const originalReplace = window.history.replaceState
    let index: number = window.history.state?.[marker] ?? 0
    let currentHref = window.location.href
    let restoring = false
    let restored: (() => void) | null = null
    const push: History['pushState'] = function (this: History, data, unused, url) { index += 1; originalPush.call(this, { ...data, [marker]: index }, unused, url); currentHref = window.location.href }
    const replace: History['replaceState'] = function (this: History, data, unused, url) { originalReplace.call(this, { ...data, [marker]: index }, unused, url); currentHref = window.location.href }
    const pop = (event: PopStateEvent) => {
      if (restoring) { event.stopImmediatePropagation(); restoring = false; restored?.(); restored = null; return }
      const nextIndex: number = event.state?.[marker] ?? index - 1
      if (!unsafe || allowDeparture.current || samePage(currentHref)) { index = nextIndex; currentHref = window.location.href; return }
      const delta = nextIndex - index
      if (!delta) return
      event.stopImmediatePropagation()
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      restoring = true
      restored = () => askToLeave(() => window.history.go(delta), trigger)
      window.history.go(-delta)
    }
    if (navigation) navigation.addEventListener('navigate', navigate)
    else {
      originalReplace.call(window.history, { ...window.history.state, [marker]: index }, '')
      window.history.pushState = push; window.history.replaceState = replace
      window.addEventListener('popstate', pop, true)
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener(SETTINGS_NAVIGATION_EVENT, imperative)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener(SETTINGS_NAVIGATION_EVENT, imperative); document.removeEventListener('click', click, true)
      navigation?.removeEventListener('navigate', navigate)
      window.removeEventListener('popstate', pop, true)
      if (window.history.pushState === push) window.history.pushState = originalPush
      if (window.history.replaceState === replace) window.history.replaceState = originalReplace
    }
  }, [unsafe])

  function cancelDeparture() {
    departureAction.current = null
    setConfirmingDeparture(false)
  }
  function confirmDeparture() {
    const proceed = departureAction.current
    if (!proceed) return
    departureAction.current = null
    allowDeparture.current = true
    setConfirmingDeparture(false)
    proceed()
  }
  function restoreDepartureFocus() {
    if (!allowDeparture.current && departureTrigger.current?.isConnected) departureTrigger.current.focus()
  }

  function changeDefinition(next: IntakeFormDefinition) {
    if (!readOnly && !inFlight.current) { setLocalDefinition(next); setServerDiagnostics([]); setNotice(null) }
  }
  function replaceSnapshot(next: IntakeFormEditorSnapshot, nextDiagnostics: IntakeFormDiagnostic[] = []) {
    setSnapshot(next); setSelectedVersionId(null); const definition = definitionFor(next)
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
      const submitted = parseIntakeFormDefinition(localDefinition)
      if (!submitted.success) throw invalidResponse()
      const submittedFingerprint = definitionFingerprint(submitted.data)
      const envelope = z.object({ draft: z.unknown(), diagnostics: diagnosticsSchema }).strict().safeParse(await jsonRequest('/draft', 'PUT', { versionId: draft.id, expectedLockVersion: draft.lock_version, definition: submitted.data }))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.draft, snapshot.template, 'draft', draft.id)
      if (next.version !== draft.version || next.lock_version !== draft.lock_version + 1 ||
        definitionFingerprint(next.definition) !== submittedFingerprint) throw invalidResponse()
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
      if (next.version !== draft.version || next.lock_version !== draft.lock_version || next.definition_hash !== draft.definition_hash ||
        definitionFingerprint(next.definition) !== definitionFingerprint(draft.definition)) throw invalidResponse()
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
    if (!version || version.status !== 'published' || busy || requestStatus === 'conflict') return
    await request(async () => {
      const envelope = z.object({ version: z.unknown() }).strict().safeParse(await jsonRequest(`/versions/${encodeURIComponent(version.id)}/retire`, 'POST', {}))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.version, snapshot.template, 'retired', version.id)
      if (next.version !== version.version || next.lock_version !== version.lock_version || next.definition_hash !== version.definition_hash ||
        definitionFingerprint(next.definition) !== definitionFingerprint(version.definition)) throw invalidResponse()
      // Retiring history must never replace a newer draft or its unsaved buffer.
      setSnapshot(current => ({ ...current, versions: current.versions.map(row => row.id === next.id ? next : row) }))
      setRequestStatus('idle')
    })
  }
  async function createNextDraft() {
    if (!version || snapshot.draft || snapshot.template.archived_at || busy || dirty || requestStatus === 'conflict') return
    await request(async () => {
      const envelope = z.object({ draft: z.unknown(), diagnostics: diagnosticsSchema }).strict().safeParse(await jsonRequest('/draft', 'POST', { sourceVersionId: version.id }))
      if (!envelope.success) throw invalidResponse()
      const next = parseVersion(envelope.data.draft, snapshot.template, 'draft')
      const highestKnownVersion = Math.max(...snapshot.versions.map(value => value.version))
      if (next.version <= highestKnownVersion || snapshot.versions.some(value => value.id === next.id) || next.lock_version !== 0 ||
        next.definition_hash !== version.definition_hash || definitionFingerprint(next.definition) !== definitionFingerprint(version.definition)) throw invalidResponse()
      replaceVersion(next, envelope.data.diagnostics)
    })
  }
  return { snapshot, version, localDefinition: displayedDefinition, selectVersion: setSelectedVersionId, changeDefinition, dirty, saveStatus, busy, readOnly, diagnostics, canPublish, error, notice,
    confirmingDeparture, cancelDeparture, confirmDeparture, restoreDepartureFocus,
    saveDraft, reloadLatest, copyLocalDefinition, publishDraft, discardDraft, retireVersion, createNextDraft }
}
