'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Device, Call as TwilioCall } from '@twilio/voice-sdk'
import {
  TelnyxRTC,
  type Call as TelnyxCall,
  type ITelnyxErrorEvent,
} from '@telnyx/webrtc'
import {
  Delete,
  Mic,
  MicOff,
  Moon,
  Pause,
  Play,
  Grid3x3,
  Briefcase,
  PhoneOff,
  Search,
  Sparkles,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'
import { contactPickerKeyAction } from '@/lib/contactPickerKeyboard'
import { openCornerstoneAssistant } from '@/app/admin/components/adminChatEvents'
import {
  OPEN_STAFF_SOFTPHONE_EVENT,
  type OpenSoftphoneDetail,
} from '@/app/admin/components/softphoneEvents'
import type { CallBriefing } from '@/lib/phoneContext'
import { openItemsSentence } from '@/lib/phoneContext'
import { usePublishSoftphoneCall } from './SoftphoneProvider'
import { usePhoneDirectory, type DirectoryEntry } from './usePhoneDirectory'

/**
 * Browser-based dialer for Cornerstone staff. Authenticates via /api/token,
 * places outbound calls through the configured provider (Twilio TwiML App or
 * Telnyx WebRTC), and accepts inbound calls routed to this user.
 *
 * Styling uses the app's semantic theme tokens only (bg-card, border-border,
 * text-primary, …) so light and dark both follow the admin theme.
 */

const STATUS = {
  CONNECTING: 'connecting',
  IDLE: 'idle',
  INCOMING: 'incoming',
  DIALING: 'dialing',
  ON_CALL: 'on_call',
  OFFLINE: 'offline',
} as const

type SoftphoneStatus = (typeof STATUS)[keyof typeof STATUS]
type Outcome = 'Reached' | 'Voicemail' | 'No answer'

const OUTCOMES: Outcome[] = ['Reached', 'Voicemail', 'No answer']
const DND_STORAGE_KEY = 'cornerstone.softphone.dnd'

const KEYPAD: [string, string][] = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
]

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = (totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  const d = digits.startsWith('1') ? digits.slice(1) : digits
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`
}

function toE164(display: string): string {
  const digits = display.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return `+${digits}`
}

function last10(value: string): string {
  return value.replace(/\D/g, '').slice(-10)
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

/** Ignore global key handling while the user is typing anywhere else in the admin. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function externalCallId(call: TwilioCall | TelnyxCall | null, provider: 'twilio' | 'telnyx'): string | null {
  if (!call) return null
  if (provider === 'twilio') return (call as TwilioCall).parameters?.CallSid ?? null
  const telnyx = call as TelnyxCall & { telnyxIDs?: { telnyxCallControlId?: string; telnyxLegId?: string }; id?: string }
  return telnyx.telnyxIDs?.telnyxCallControlId ?? telnyx.telnyxIDs?.telnyxLegId ?? telnyx.id ?? null
}

export default function Softphone() {
  const [status, setStatus] = useState<SoftphoneStatus>(STATUS.CONNECTING)
  const [number, setNumber] = useState('')
  const [muted, setMuted] = useState(false)
  const [held, setHeld] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [showKeypad, setShowKeypad] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [incomingFrom, setIncomingFrom] = useState('')
  const [provider, setProvider] = useState<'twilio' | 'telnyx'>('twilio')
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('outbound')
  const [participant, setParticipant] = useState('')
  const [outboundNumber, setOutboundNumber] = useState<string | null>(null)

  // wrap-up
  const [wrapUp, setWrapUp] = useState<{
    durationSeconds: number
    participantNumber: string
    direction: 'inbound' | 'outbound'
    externalCallId: string | null
    entry: DirectoryEntry | null
  } | null>(null)
  const [wrapUpNotes, setWrapUpNotes] = useState('')
  const [wrapUpOutcome, setWrapUpOutcome] = useState<Outcome>('Reached')
  const [saving, setSaving] = useState(false)
  const [summaryDrafted, setSummaryDrafted] = useState(false)
  const [checkedFollowUps, setCheckedFollowUps] = useState<string[]>([])

  // Directory search + per-call briefing
  const [search, setSearch] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [briefing, setBriefing] = useState<CallBriefing | null>(null)
  const [wrapUpBriefing, setWrapUpBriefing] = useState<CallBriefing | null>(null)

  const providerRef = useRef<'twilio' | 'telnyx'>('twilio')
  const deviceRef = useRef<Device | TelnyxRTC | null>(null)
  const callRef = useRef<TwilioCall | TelnyxCall | null>(null)
  const callerNumberRef = useRef<string | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const numberInputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef(0)
  const connectedRef = useRef(false)
  const directionRef = useRef<'inbound' | 'outbound'>('outbound')
  const participantRef = useRef('')
  // Read by cleanupCall. Kept in a ref because cleanupCall is a dependency of
  // the device-setup effect — making it depend on briefing state would tear
  // the Twilio/Telnyx device down and rebuild it mid-call.
  const briefingRef = useRef<CallBriefing | null>(null)
  const statusRef = useRef<SoftphoneStatus>(STATUS.CONNECTING)
  // Read by the summary-draft effect, which must not re-run as the operator types.
  const wrapUpNotesRef = useRef('')
  const wrapUpOutcomeRef = useRef<Outcome>('Reached')

  const router = useRouter()

  useEffect(() => {
    try {
      setDnd(window.localStorage.getItem(DND_STORAGE_KEY) === '1')
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }, [])

  const toggleDnd = useCallback(() => {
    setDnd(previous => {
      const next = !previous
      try {
        window.localStorage.setItem(DND_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // DND still works for this session when storage is unavailable.
      }
      return next
    })
  }, [])

  useEffect(() => {
    wrapUpNotesRef.current = wrapUpNotes
    wrapUpOutcomeRef.current = wrapUpOutcome
  }, [wrapUpNotes, wrapUpOutcome])

  const { entries, lookup } = usePhoneDirectory()
  const lookupRef = useRef(lookup)

  useEffect(() => {
    lookupRef.current = lookup
  }, [lookup])

  const dialedEntry = useMemo(() => {
    const digits = last10(number)
    return digits.length >= 3 ? lookup(digits) : null
  }, [number, lookup])

  // Where "SMS" goes for whoever is on this number. The directory carries
  // leads and contacts too now, so keying this off matterId alone left the
  // button dead for every fiduciary, referrer and lead in it.
  const smsHref = useMemo(() => {
    if (!dialedEntry) return null
    if (dialedEntry.matterId) {
      return `/admin/matters/${dialedEntry.matterId}?tab=communications&channel=sms`
    }
    if (dialedEntry.leadId) {
      return `/admin/crm/opportunities/${dialedEntry.leadId}?tab=communications`
    }
    if (dialedEntry.contactId) {
      return `/admin/crm/people?selected=contact:${dialedEntry.contactId}`
    }
    return null
  }, [dialedEntry])

  const incomingEntry = useMemo(
    () => (incomingFrom ? lookup(last10(incomingFrom)) : null),
    [incomingFrom, lookup],
  )

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const startTimer = useCallback(() => {
    stopTimer()
    secondsRef.current = 0
    setSeconds(0)
    timerRef.current = setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
    }, 1000)
  }, [stopTimer])

  const cleanupCall = useCallback(() => {
    stopTimer()
    if (connectedRef.current) {
      const digits = last10(participantRef.current)
      setWrapUp({
        durationSeconds: secondsRef.current,
        participantNumber: participantRef.current,
        direction: directionRef.current,
        externalCallId: externalCallId(callRef.current, providerRef.current),
        entry: digits ? lookupRef.current(digits) : null,
      })
      setWrapUpBriefing(briefingRef.current)
      setWrapUpNotes('')
      setWrapUpOutcome('Reached')
      setSummaryDrafted(false)
      setCheckedFollowUps([])
    }
    connectedRef.current = false
    secondsRef.current = 0
    setSeconds(0)
    setMuted(false)
    setHeld(false)
    setShowKeypad(false)
    setIncomingFrom('')
    callRef.current = null
    setStatus(deviceRef.current ? STATUS.IDLE : STATUS.OFFLINE)
  }, [stopTimer])

  const markConnected = useCallback(() => {
    connectedRef.current = true
    setStatus(STATUS.ON_CALL)
    setMuted(false)
    setHeld(false)
    startTimer()
  }, [startTimer])

  const wireTwilioCall = useCallback(
    (call: TwilioCall) => {
      call.on('accept', markConnected)
      call.on('disconnect', cleanupCall)
      call.on('cancel', cleanupCall)
      call.on('reject', cleanupCall)
      call.on('error', (e: Error) => {
        setError(e?.message || 'Call error')
        cleanupCall()
      })
    },
    [cleanupCall, markConnected],
  )

  const fetchToken = useCallback(async (): Promise<{
    provider: 'twilio' | 'telnyx'
    token: string
    callerNumber?: string | null
  }> => {
    const res = await fetch('/api/token')
    if (!res.ok) throw new Error('Token request failed')
    const auth = await res.json()
    if (typeof auth?.token !== 'string' || !auth.token) throw new Error('Token response was malformed')
    return auth
  }, [])

  useEffect(() => {
    let device: Device | TelnyxRTC | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    void (async () => {
      try {
        const auth = await fetchToken()
        if (cancelled) return
        providerRef.current = auth.provider === 'telnyx' ? 'telnyx' : 'twilio'
        setProvider(providerRef.current)
        callerNumberRef.current = auth.callerNumber ?? null
        setOutboundNumber(auth.callerNumber ? formatPhone(auth.callerNumber) : null)
        setOutboundNumber(auth.callerNumber ? formatPhone(auth.callerNumber) : null)

        if (auth.provider === 'telnyx') {
          const telnyx = new TelnyxRTC({ login_token: auth.token })
          device = telnyx
          if (remoteAudioRef.current) telnyx.remoteElement = remoteAudioRef.current
          telnyx.on('telnyx.ready', () => {
            if (cancelled) return
            setError(null)
            setStatus(STATUS.IDLE)
          })
          telnyx.on('telnyx.error', (event: ITelnyxErrorEvent) => {
            if (cancelled) return
            setError(event.error?.message || 'Softphone connection error')
            if (event.error?.fatal) setStatus(STATUS.OFFLINE)
          })
          telnyx.on('telnyx.socket.close', () => {
            if (!cancelled) setStatus(STATUS.OFFLINE)
          })
          telnyx.on('telnyx.notification', (notification) => {
            if (cancelled) return
            if (notification.type !== 'callUpdate' || !notification.call) return
            const call = notification.call
            callRef.current = call
            const remote = call.options?.remoteCallerNumber || call.options?.destinationNumber || ''
            if (call.state === 'ringing' && call.direction === 'inbound') {
              directionRef.current = 'inbound'
              setDirection('inbound')
              participantRef.current = remote
              setParticipant(remote)
              setIncomingFrom(remote || 'Unknown caller')
              setStatus(STATUS.INCOMING)
            } else if (call.state === 'active') {
              if (remote) {
                participantRef.current = remote
                setParticipant(remote)
              }
              markConnected()
            } else if (call.state === 'held') {
              setHeld(true)
            } else if (call.state === 'hangup' || call.state === 'destroy') {
              cleanupCall()
            }
          })
          deviceRef.current = telnyx
          await telnyx.connect()

          // Telnyx login tokens are short-lived: reconnect with a fresh one
          // rather than calling login() on a live socket.
          const scheduleReconnect = () => {
            refreshTimer = setTimeout(async () => {
              if (cancelled) return
              try {
                const fresh = await fetchToken()
                if (cancelled) return
                // safe only when no call is up; otherwise defer
                if (callRef.current) return scheduleReconnect()
                await telnyx.disconnect()
                telnyx.options.login_token = fresh.token
                await telnyx.connect()
                scheduleReconnect()
              } catch {
                setError('Could not refresh softphone credentials')
                setStatus(STATUS.OFFLINE)
              }
            }, 45 * 60 * 1000)
          }
          scheduleReconnect()
          return
        }

        const twilioDevice = new Device(auth.token, {
          codecPreferences: [TwilioCall.Codec.Opus, TwilioCall.Codec.PCMU],
          allowIncomingWhileBusy: false,
        })
        device = twilioDevice
        twilioDevice.on('registered', () => setStatus(STATUS.IDLE))
        twilioDevice.on('unregistered', () => setStatus(STATUS.OFFLINE))
        twilioDevice.on('error', (e: Error) => {
          setError(e?.message || 'Device error')
          setStatus(STATUS.OFFLINE)
        })
        twilioDevice.on('incoming', (call: TwilioCall) => {
          callRef.current = call
          const from = call.parameters?.From || ''
          directionRef.current = 'inbound'
          setDirection('inbound')
          participantRef.current = from
          setParticipant(from)
          setIncomingFrom(from || 'Unknown caller')
          setStatus(STATUS.INCOMING)
          wireTwilioCall(call)
        })
        twilioDevice.on('tokenWillExpire', async () => {
          try {
            const fresh = await fetchToken()
            twilioDevice.updateToken(fresh.token)
          } catch {
            setError('Could not refresh softphone credentials')
          }
        })

        await twilioDevice.register()
        deviceRef.current = twilioDevice
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not start softphone')
          setStatus(STATUS.OFFLINE)
        }
      }
    })()

    return () => {
      cancelled = true
      if (refreshTimer) clearTimeout(refreshTimer)
      stopTimer()
      if (device instanceof Device) device.destroy()
      else void device?.disconnect()
    }
  }, [cleanupCall, fetchToken, markConnected, stopTimer, wireTwilioCall])

  const placeCall = useCallback(async () => {
    const device = deviceRef.current
    if (!device || dnd || last10(number).length < 10) return
    try {
      directionRef.current = 'outbound'
      setDirection('outbound')
      const participantNumber = toE164(number)
      participantRef.current = participantNumber
      setParticipant(participantNumber)
      setWrapUp(null)
      setStatus(STATUS.DIALING)
      if (providerRef.current === 'telnyx' && device instanceof TelnyxRTC) {
        callRef.current = device.newCall({
          destinationNumber: toE164(number),
          callerNumber: callerNumberRef.current ?? undefined,
          audio: true,
          remoteElement: remoteAudioRef.current ?? undefined,
        })
      } else if (device instanceof Device) {
        const call = await device.connect({ params: { To: toE164(number) } })
        callRef.current = call
        wireTwilioCall(call)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place call')
      cleanupCall()
    }
  }, [cleanupCall, dnd, number, wireTwilioCall])

  const acceptCall = useCallback(() => {
    const call = callRef.current
    if (!call) return
    setWrapUp(null)
    if (providerRef.current === 'telnyx') void (call as TelnyxCall).answer({ remoteElement: remoteAudioRef.current ?? undefined })
    else (call as TwilioCall).accept()
  }, [])

  const rejectCall = useCallback(() => {
    const call = callRef.current
    if (!call) return
    if (providerRef.current === 'telnyx') void (call as TelnyxCall).hangup()
    else (call as TwilioCall).reject()
  }, [])

  const hangUp = useCallback(() => {
    const call = callRef.current
    if (!call) return
    if (providerRef.current === 'telnyx') void (call as TelnyxCall).hangup()
    else (call as TwilioCall).disconnect()
  }, [])

  const toggleMute = useCallback(() => {
    const call = callRef.current
    if (!call) return
    const next = !muted
    if (providerRef.current === 'telnyx') {
      if (next) (call as TelnyxCall).muteAudio()
      else (call as TelnyxCall).unmuteAudio()
    } else {
      (call as TwilioCall).mute(next)
    }
    setMuted(next)
  }, [muted])

  const toggleHold = useCallback(async () => {
    const call = callRef.current
    if (!call || providerRef.current !== 'telnyx') return
    const next = !held
    try {
      if (next) await (call as TelnyxCall).hold()
      else await (call as TelnyxCall).unhold()
      setHeld(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hold the call')
    }
  }, [held])

  const pressKey = useCallback(
    (digit: string) => {
      if (status === STATUS.ON_CALL) {
        const call = callRef.current
        if (providerRef.current === 'telnyx') (call as TelnyxCall | null)?.dtmf(digit)
        else (call as TwilioCall | null)?.sendDigits(digit)
        return
      }
      if (status !== STATUS.IDLE) return
      setNumber(prev => formatPhone(prev.replace(/\D/g, '') + digit))
    },
    [status],
  )

  const backspace = useCallback(() => {
    setNumber(prev => formatPhone(prev.replace(/\D/g, '').slice(0, -1)))
  }, [])

  // Enter dials, Backspace deletes — only when focus is inside the softphone,
  // so typing in the matters search never reaches the dialer.
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const root = rootRef.current
      const active = document.activeElement
      const inside = !!root && !!active && root.contains(active)
      if (!inside) return
      // Inputs and textareas inside the softphone handle their own typing;
      // only the number input's Enter should dial.
      if (isTypingTarget(e.target) && e.target !== numberInputRef.current) return
      if (status === STATUS.ON_CALL) {
        if (/^[0-9*#]$/.test(e.key) && !isTypingTarget(e.target)) pressKey(e.key)
        return
      }
      if (status !== STATUS.IDLE) return
      if (/^[0-9*#]$/.test(e.key) && e.target !== numberInputRef.current) pressKey(e.key)
      else if (e.key === 'Enter' && !dnd) void placeCall()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dnd, placeCall, pressKey, status])

  // The wrap-up form shows the instant the call ends; the drafted summary
  // arrives afterwards and only fills a textarea the operator hasn't touched.
  useEffect(() => {
    if (!wrapUp) return
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/admin/phone/call-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction: wrapUp.direction,
            durationSeconds: wrapUp.durationSeconds,
            participantName: wrapUp.entry?.name ?? null,
            outcome: wrapUpOutcomeRef.current,
            notes: wrapUpNotesRef.current,
            matterId: wrapUp.entry?.matterId ?? null,
            leadId: wrapUp.entry?.leadId ?? null,
            openItems: briefingRef.current?.openItems ?? [],
          }),
        })
        if (!res.ok) return
        const data = (await res.json()) as { draft?: string }
        const draft = data.draft?.trim()
        if (cancelled || !draft) return
        // Never clobber notes the operator typed while waiting.
        setWrapUpNotes(prev => (prev.trim() ? prev : draft))
        setSummaryDrafted(true)
      } catch {
        /* silent: an empty textarea is the documented failure mode */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [wrapUp])

  /** Follow-ups reuse the endpoints the record pages already post to. */
  const runFollowUps = useCallback(async (summary: string) => {
    const followUps = wrapUpBriefing?.followUps ?? []
    const selected = followUps.filter(item => checkedFollowUps.includes(item.id))
    if (selected.length === 0 || !summary.trim() || !wrapUpBriefing) return

    for (const followUp of selected) {
      try {
        if (followUp.kind === 'lead_note') {
          await fetch(`/api/admin/leads/${wrapUpBriefing.recordId}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: summary }),
          })
        } else {
          await fetch('/api/admin/chat/save-note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context_type: 'matter',
              context_id: wrapUpBriefing.recordId,
              content: summary,
              note_type: 'client_comm',
            }),
          })
        }
      } catch {
        /* the call itself is already saved; a failed follow-up isn't fatal */
      }
    }
  }, [checkedFollowUps, wrapUpBriefing])

  const saveWrapUp = useCallback(async () => {
    if (!wrapUp) return
    setSaving(true)
    const notes = wrapUpNotes.trim()
    try {
      const res = await fetch('/api/admin/phone/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalCallId: wrapUp.externalCallId,
          participantNumber: wrapUp.participantNumber,
          direction: wrapUp.direction,
          durationSeconds: wrapUp.durationSeconds,
          outcome: wrapUpOutcome,
          notes: notes || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not save the call')
      await runFollowUps(notes)
      // Same refresh the record pages run after their own mutations, so the
      // call and any follow-up note appear in the timeline without a reload.
      invalidateSidebarCountsClient()
      router.refresh()
      setWrapUp(null)
      setWrapUpBriefing(null)
      setNumber('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the call')
    } finally {
      setSaving(false)
    }
  }, [router, runFollowUps, wrapUp, wrapUpNotes, wrapUpOutcome])

  const inCall = status === STATUS.ON_CALL || status === STATUS.DIALING
  const canDial = status === STATUS.IDLE && !dnd && last10(number).length >= 10

  const activeEntry = direction === 'inbound' ? incomingEntry : dialedEntry

  const statusLabel: Record<SoftphoneStatus, string> = {
    [STATUS.CONNECTING]: 'Connecting',
    [STATUS.IDLE]: dnd ? 'Do not disturb' : 'Ready',
    [STATUS.INCOMING]: 'Ringing',
    [STATUS.DIALING]: 'Dialing',
    [STATUS.ON_CALL]: held ? 'On hold' : 'On call',
    [STATUS.OFFLINE]: 'Offline',
  }

  // ── call context ──────────────────────────────────────────────────
  // One read when a call arrives or is placed — never per keystroke. The
  // briefing is cleared the moment the matched record changes so a new call
  // can never show the previous caller's open items.
  const briefingKey =
    status === STATUS.INCOMING || inCall
      ? activeEntry?.matterId
        ? `matter:${activeEntry.matterId}`
        : activeEntry?.leadId
          ? `lead:${activeEntry.leadId}`
          : null
      : null

  useEffect(() => {
    setBriefing(null)
    briefingRef.current = null
    if (!briefingKey) return

    const [type, id] = briefingKey.split(':')
    const query = type === 'matter' ? `matterId=${id}` : `leadId=${id}`
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(`/api/admin/phone/context?${query}`)
        if (!res.ok) return
        const data = (await res.json()) as { briefing?: CallBriefing | null }
        if (cancelled || !data.briefing) return
        setBriefing(data.briefing)
        briefingRef.current = data.briefing
      } catch {
        /* the briefing is an enhancement — the call works without it */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [briefingKey])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  // ── directory search ──────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query.length < 2) return []
    const queryDigits = query.replace(/\D/g, '')
    return entries
      .filter(entry =>
        entry.name.toLowerCase().includes(query) ||
        (entry.matterNumber?.toLowerCase().includes(query) ?? false) ||
        // Lets "trustee" or "spouse" find people who have no matter number.
        (entry.detail?.toLowerCase().includes(query) ?? false) ||
        (queryDigits.length >= 3 && entry.digits.includes(queryDigits)),
      )
      .slice(0, 6)
  }, [entries, search])

  useEffect(() => {
    setSearchIndex(0)
  }, [search])

  const selectDirectoryEntry = useCallback((entry: DirectoryEntry) => {
    setNumber(formatPhone(entry.digits))
    setSearch('')
    numberInputRef.current?.focus()
  }, [])

  // Click-to-call from a lead or matter record lands here.
  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<OpenSoftphoneDetail>).detail
      const digits = last10(detail?.number ?? '')
      if (!digits || statusRef.current !== STATUS.IDLE) return
      setNumber(formatPhone(digits))
      setSearch('')
    }
    window.addEventListener(OPEN_STAFF_SOFTPHONE_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_STAFF_SOFTPHONE_EVENT, onOpen)
  }, [])

  const callName = activeEntry?.name ?? formatPhone(participant) ?? ''
  const callSnapshot = useMemo(
    () => ({
      active: inCall,
      incoming: status === STATUS.INCOMING,
      connected: status === STATUS.ON_CALL,
      muted,
      held,
      seconds,
      name: callName,
      statusLabel: statusLabel[status],
      wrapUpPending: Boolean(wrapUp),
    }),
    // statusLabel is rebuilt every render; status/dnd/held already cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inCall, status, muted, held, seconds, callName, dnd, wrapUp],
  )
  usePublishSoftphoneCall(callSnapshot, { toggleMute, hangUp })

  const liveAssistSentence = briefing ? openItemsSentence(briefing) : null

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col bg-card text-card-foreground"
    >
      <audio ref={remoteAudioRef} autoPlay />

      <div className="min-h-0 flex-1 overflow-y-auto">
      {/* ── wrap-up (replaces the body so notes can't be lost) ───────── */}
      {wrapUp && (
        <section className="px-4 py-4" aria-label="Call wrap-up">
          <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Call ended · {formatDuration(wrapUp.durationSeconds)} · {wrapUp.direction}
          </p>
          <p className="mt-2 text-xl leading-tight">
            {wrapUp.entry?.name ?? formatPhone(wrapUp.participantNumber) ?? 'Unknown caller'}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {wrapUp.entry ? 'Saved to the call log' : 'No matching client — saved to the call log'}
          </p>

          <div className="mt-4 flex gap-1.5" role="group" aria-label="Outcome">
            {OUTCOMES.map(o => (
              <button
                key={o}
                type="button"
                onClick={() => setWrapUpOutcome(o)}
                aria-pressed={wrapUpOutcome === o}
                className={cn(
                  'flex-1 rounded-lg border py-2 text-[9px] font-medium uppercase tracking-[0.1em]',
                  wrapUpOutcome === o
                    ? 'border-primary text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {o}
              </button>
            ))}
          </div>

          {summaryDrafted && (
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Sparkles size={11} aria-hidden className="text-primary" />
              Drafted by the assistant — edit before saving
            </p>
          )}
          <label className={cn('block', summaryDrafted ? 'mt-1' : 'mt-3')}>
            <span className="sr-only">Call notes</span>
            <textarea
              value={wrapUpNotes}
              onChange={e => setWrapUpNotes(e.target.value)}
              rows={4}
              placeholder="Call notes…"
              className="w-full resize-y rounded-[10px] border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed outline-none focus:border-primary"
            />
          </label>

          {(wrapUpBriefing?.followUps.length ?? 0) > 0 && (
            <fieldset className="mt-3">
              <legend className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Follow-ups
              </legend>
              {wrapUpBriefing!.followUps.map(followUp => (
                <label key={followUp.id} className="mt-1.5 flex items-start gap-2 text-[11px] leading-snug">
                  <input
                    type="checkbox"
                    checked={checkedFollowUps.includes(followUp.id)}
                    onChange={e =>
                      setCheckedFollowUps(prev =>
                        e.target.checked
                          ? [...prev, followUp.id]
                          : prev.filter(id => id !== followUp.id),
                      )
                    }
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
                  />
                  <span>{followUp.label}</span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setWrapUp(null)}
              disabled={saving}
              className="flex-1 rounded-[10px] border border-border py-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void saveWrapUp()}
              disabled={saving}
              className="flex-[2] rounded-[10px] bg-primary py-3 text-[10px] font-medium uppercase tracking-[0.12em] text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : wrapUp.entry?.matterNumber ? 'Save to matter' : 'Save call'}
            </button>
          </div>
        </section>
      )}

      {/* ── incoming ─────────────────────────────────────────────────── */}
      {!wrapUp && status === STATUS.INCOMING && (
        <section className="px-4 py-6 text-center" aria-label="Incoming call">
          <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-primary motion-safe:animate-pulse">
            Incoming call
          </p>
          <p className="mt-3 text-[22px] leading-tight">
            {incomingEntry?.name ?? formatPhone(incomingFrom) ?? incomingFrom}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{formatPhone(incomingFrom) || incomingFrom}</p>
          {(incomingEntry?.matterNumber ?? incomingEntry?.detail) && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[10px]">
              <span className="h-[5px] w-[5px] rounded-full bg-primary" aria-hidden />
              {incomingEntry.matterNumber ?? incomingEntry.detail}
              {incomingEntry.practiceArea ? ` · ${incomingEntry.practiceArea}` : ''}
            </p>
          )}
          {briefing && (
            <div
              className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left"
              aria-label="Before you answer"
            >
              <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Before you answer
              </p>
              <p className="mt-1 text-xs font-medium leading-snug">{briefing.headline}</p>
              {briefing.lines.map(line => (
                <p key={line} className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={rejectCall}
              className="flex-1 rounded-[10px] border border-destructive py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-destructive"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={acceptCall}
              className="flex-1 rounded-[10px] bg-primary py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-primary-foreground hover:opacity-90"
            >
              Answer
            </button>
          </div>
        </section>
      )}

      {/* ── dialing ──────────────────────────────────────────────────── */}
      {!wrapUp && status === STATUS.DIALING && (
        <section className="px-4 py-8 text-center" aria-label="Dialing">
          <span className="grid h-14 w-14 place-items-center rounded-full border border-border bg-muted/40 mx-auto font-medium text-primary">
            {initials(dialedEntry?.name ?? '') || '☏'}
          </span>
          <p className="mt-4 text-xl leading-tight">
            {dialedEntry?.name ?? formatPhone(number)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Calling · {formatPhone(number)}</p>
          <button
            type="button"
            onClick={hangUp}
            className="mt-6 w-full rounded-[10px] border border-destructive py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-destructive"
          >
            Cancel
          </button>
        </section>
      )}

      {/* ── active call ──────────────────────────────────────────────── */}
      {!wrapUp && status === STATUS.ON_CALL && (
        <section className="px-4 py-4" aria-label="Active call">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-muted/40 text-xs font-medium text-primary">
              {initials(activeEntry?.name ?? '') || '☏'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg leading-tight">
                {activeEntry?.name ?? formatPhone(participant)}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {activeEntry?.matterNumber ?? formatPhone(participant)}
              </p>
            </div>
            <span className="text-sm font-medium tabular-nums text-primary">{formatDuration(seconds)}</span>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={muted}
              className={cn(
                'grid place-items-center gap-1 rounded-[10px] border py-2.5',
                muted ? 'border-primary text-primary' : 'border-border hover:bg-muted/50',
              )}
            >
              {muted ? <MicOff size={15} aria-hidden /> : <Mic size={15} aria-hidden />}
              <span className="text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {muted ? 'Unmute' : 'Mute'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void toggleHold()}
              aria-pressed={held}
              disabled={provider !== 'telnyx'}
              title={provider !== 'telnyx' ? 'Hold requires the Telnyx line' : undefined}
              className={cn(
                'grid place-items-center gap-1 rounded-[10px] border py-2.5 disabled:opacity-40',
                held ? 'border-primary text-primary' : 'border-border hover:bg-muted/50',
              )}
            >
              {held ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
              <span className="text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {held ? 'Resume' : 'Hold'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowKeypad(prev => !prev)}
              aria-pressed={showKeypad}
              aria-label="Keypad"
              className={cn(
                'grid place-items-center gap-1 rounded-[10px] border py-2.5',
                showKeypad ? 'border-primary text-primary' : 'border-border hover:bg-muted/50',
              )}
            >
              <Grid3x3 size={15} aria-hidden />
              <span className="text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Keypad</span>
            </button>
            <a
              href={activeEntry?.matterId ? `/admin/matters/${activeEntry.matterId}` : undefined}
              aria-disabled={!activeEntry?.matterId}
              className={cn(
                'grid place-items-center gap-1 rounded-[10px] border border-border py-2.5',
                activeEntry?.matterId ? 'hover:bg-muted/50' : 'pointer-events-none opacity-40',
              )}
            >
              <Briefcase size={15} aria-hidden />
              <span className="text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Matter</span>
            </a>
          </div>

          {showKeypad && (
            <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Dial pad">
              {KEYPAD.map(([digit, letters]) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => pressKey(digit)}
                  className="grid place-items-center gap-px rounded-[10px] border border-border bg-background py-2 pt-2.5 hover:bg-muted/60 active:translate-y-px"
                >
                  <span className="text-xl leading-none">{digit}</span>
                  <span className="min-h-[7px] text-[7px] font-medium tracking-[0.16em] text-muted-foreground">
                    {letters}
                  </span>
                </button>
              ))}
            </div>
          )}

          {briefing && liveAssistSentence && (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5" aria-label="Live assist">
              <p className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Sparkles size={11} aria-hidden className="text-primary" />
                Live assist
              </p>
              <p className="mt-1 text-[11px] leading-relaxed">{liveAssistSentence}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {briefing.assistPrompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => openCornerstoneAssistant({ prompt })}
                    className="rounded-full border border-border bg-background px-2 py-1 text-[10px] font-medium hover:border-primary hover:text-primary"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={hangUp}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] bg-destructive py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-destructive-foreground"
          >
            <PhoneOff size={14} aria-hidden />
            End call
          </button>
        </section>
      )}

      {/* ── idle: dial pad ───────────────────────────────────────────── */}
      {!wrapUp && (status === STATUS.IDLE || status === STATUS.CONNECTING || status === STATUS.OFFLINE) && (
        <section className="px-4 pb-4 pt-4">
          <div className="relative">
            <Search
              size={13}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                const result = contactPickerKeyAction(e.key, searchIndex, searchResults.length, true)
                if (result.preventDefault) e.preventDefault()
                setSearchIndex(result.activeIndex)
                if (result.selectIndex !== null && searchResults[result.selectIndex]) {
                  selectDirectoryEntry(searchResults[result.selectIndex])
                }
                if (!result.open) setSearch('')
              }}
              placeholder="Search the firm directory…"
              aria-label="Search the firm directory"
              role="combobox"
              aria-expanded={searchResults.length > 0}
              aria-controls="softphone-directory-results"
              className="h-8 w-full rounded-[10px] border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          {searchResults.length > 0 && (
            <div
              id="softphone-directory-results"
              className="mt-1.5 overflow-hidden rounded-[10px] border border-border"
              role="listbox"
              aria-label="Directory results"
            >
              {searchResults.map((entry, index) => (
                <button
                  key={`${entry.digits}-${entry.name}`}
                  type="button"
                  role="option"
                  aria-selected={index === searchIndex}
                  onMouseEnter={() => setSearchIndex(index)}
                  onClick={() => selectDirectoryEntry(entry)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-2.5 py-2 text-left',
                    index === searchIndex ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {initials(entry.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{entry.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {entry.detail ?? entry.matterNumber ?? 'Contact'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-baseline gap-2 border-b border-border pb-2.5">
            <input
              ref={numberInputRef}
              className="min-h-[29px] min-w-0 flex-1 border-0 bg-transparent p-0 text-2xl outline-none placeholder:text-lg placeholder:text-muted-foreground"
              value={number}
              onChange={e => setNumber(formatPhone(e.target.value))}
              placeholder="Enter a number"
              inputMode="tel"
              aria-label="Phone number"
            />
            {number && (
              <button
                type="button"
                onClick={backspace}
                aria-label="Delete last digit"
                className="text-muted-foreground hover:text-foreground"
              >
                <Delete size={15} aria-hidden />
              </button>
            )}
          </div>

          {dialedEntry && (
            <button
              type="button"
              onClick={() => setNumber(formatPhone(dialedEntry.digits))}
              className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left hover:border-primary"
            >
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {initials(dialedEntry.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{dialedEntry.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {dialedEntry.detail ?? dialedEntry.matterNumber ?? 'Contact'}
                </span>
              </span>
            </button>
          )}

          <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Dial pad">
            {KEYPAD.map(([digit, letters]) => (
              <button
                key={digit}
                type="button"
                onClick={() => pressKey(digit)}
                className="grid place-items-center gap-px rounded-[10px] border border-border bg-background py-2 pt-2.5 hover:bg-muted/60 active:translate-y-px"
              >
                <span className="text-xl leading-none">{digit}</span>
                <span className="min-h-[7px] text-[7px] font-medium tracking-[0.16em] text-muted-foreground">
                  {letters}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <a
              href={smsHref ?? undefined}
              aria-disabled={!smsHref}
              title={smsHref ? undefined : 'This number isn’t in the firm directory yet'}
              className={cn(
                'grid w-11 place-items-center rounded-[10px] border border-border text-[10px] font-medium tracking-[0.08em] text-muted-foreground',
                smsHref ? 'hover:text-foreground' : 'pointer-events-none opacity-40',
              )}
            >
              SMS
            </a>
            <button
              type="button"
              onClick={() => void placeCall()}
              disabled={!canDial}
              className="flex-1 rounded-[10px] bg-primary py-3.5 text-[11px] font-medium uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90 disabled:opacity-45"
            >
              Call
            </button>
          </div>
        </section>
      )}

      </div>

      {error && (
        <p
          role="alert"
          onClick={() => setError(null)}
          className="shrink-0 cursor-pointer border-t border-border bg-destructive/10 px-4 py-2 text-center text-[11px] text-destructive"
        >
          {error} — tap to dismiss
        </p>
      )}

      {/* ── rail footer: line status, outbound number, DND ───────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
        <span
          aria-hidden
          className={cn(
            'h-[7px] w-[7px] shrink-0 rounded-full',
            status === STATUS.OFFLINE && 'bg-destructive',
            dnd && status !== STATUS.OFFLINE && 'bg-destructive',
            !dnd && status === STATUS.IDLE && 'bg-success',
            !dnd && (status === STATUS.ON_CALL || status === STATUS.DIALING || status === STATUS.INCOMING) &&
              'bg-primary motion-safe:animate-pulse',
            status === STATUS.CONNECTING && 'bg-muted-foreground motion-safe:animate-pulse',
          )}
        />
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.1em]">
          {statusLabel[status]}
        </span>
        {outboundNumber && (
          <span className="truncate text-[11px] text-muted-foreground">· {outboundNumber}</span>
        )}
        <button
          type="button"
          onClick={toggleDnd}
          disabled={inCall}
          aria-pressed={dnd}
          aria-label={dnd ? 'Disable do not disturb' : 'Enable do not disturb'}
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-medium tracking-[0.1em] disabled:opacity-40',
            dnd ? 'border-destructive text-destructive' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <Moon size={10} aria-hidden />
          {dnd ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}
