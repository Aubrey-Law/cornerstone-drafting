'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Device, Call as TwilioCall } from '@twilio/voice-sdk'
import { TelnyxRTC, type Call as TelnyxCall } from '@telnyx/webrtc'
import { Delete, Mic, MicOff, Minus, Moon, Pause, Play, Grid3x3, Briefcase, PhoneOff } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  const [minimized, setMinimized] = useState(false)
  const [showKeypad, setShowKeypad] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [incomingFrom, setIncomingFrom] = useState('')

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

  const { lookup } = usePhoneDirectory()

  const dialedEntry = useMemo(() => {
    const digits = last10(number)
    return digits.length >= 3 ? lookup(digits) : null
  }, [number, lookup])

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
        entry: digits ? lookup(digits) : null,
      })
      setWrapUpNotes('')
      setWrapUpOutcome('Reached')
      setMinimized(false)
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
  }, [lookup, stopTimer])

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
        callerNumberRef.current = auth.callerNumber ?? null

        if (auth.provider === 'telnyx') {
          const telnyx = new TelnyxRTC({ login_token: auth.token })
          device = telnyx
          if (remoteAudioRef.current) telnyx.remoteElement = remoteAudioRef.current
          telnyx.on('telnyx.ready', () => setStatus(STATUS.IDLE))
          telnyx.on('telnyx.error', (e: Error) => {
            setError(e?.message || 'Device error')
            setStatus(STATUS.OFFLINE)
          })
          telnyx.on('telnyx.socket.close', () => setStatus(STATUS.OFFLINE))
          telnyx.on('telnyx.notification', (notification) => {
            if (notification.type !== 'callUpdate' || !notification.call) return
            const call = notification.call
            callRef.current = call
            const remote = call.options?.remoteCallerNumber || call.options?.destinationNumber || ''
            if (call.state === 'ringing' && call.direction === 'inbound') {
              directionRef.current = 'inbound'
              participantRef.current = remote
              setIncomingFrom(remote || 'Unknown caller')
              setStatus(STATUS.INCOMING)
            } else if (call.state === 'active') {
              if (remote) participantRef.current = remote
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
          participantRef.current = from
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
      participantRef.current = toE164(number)
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

  const saveWrapUp = useCallback(async () => {
    if (!wrapUp) return
    setSaving(true)
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
          notes: wrapUpNotes.trim() || null,
          matterId: wrapUp.entry?.matterId ?? null,
          leadId: wrapUp.entry?.leadId ?? null,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not save the call')
      setWrapUp(null)
      setNumber('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the call')
    } finally {
      setSaving(false)
    }
  }, [wrapUp, wrapUpNotes, wrapUpOutcome])

  const inCall = status === STATUS.ON_CALL || status === STATUS.DIALING
  const canDial = status === STATUS.IDLE && !dnd && last10(number).length >= 10
  const activeEntry = directionRef.current === 'inbound' ? incomingEntry : dialedEntry

  const statusLabel: Record<SoftphoneStatus, string> = {
    [STATUS.CONNECTING]: 'Connecting',
    [STATUS.IDLE]: dnd ? 'Do not disturb' : 'Ready',
    [STATUS.INCOMING]: 'Ringing',
    [STATUS.DIALING]: 'Dialing',
    [STATUS.ON_CALL]: held ? 'On hold' : 'On call',
    [STATUS.OFFLINE]: 'Offline',
  }

  if (minimized && inCall) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label="Open active call"
        className="flex items-center gap-2.5 rounded-full border border-border bg-card py-2 pl-3 pr-4 shadow-lg transition-shadow hover:shadow-xl"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground">
          <Mic size={13} aria-hidden />
        </span>
        <span className="text-left">
          <span className="block text-xs font-medium leading-tight">
            {activeEntry?.name ?? formatPhone(participantRef.current) ?? 'Call'}
          </span>
          <span className="block text-[10px] uppercase tracking-wider text-primary tabular-nums">
            {formatDuration(seconds)} · on call
          </span>
        </span>
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className="w-[328px] overflow-hidden rounded-[14px] border border-border bg-card text-card-foreground shadow-lg"
    >
      <audio ref={remoteAudioRef} autoPlay />

      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'h-[7px] w-[7px] shrink-0 rounded-full',
              status === STATUS.OFFLINE && 'bg-destructive',
              dnd && status !== STATUS.OFFLINE && 'bg-destructive',
              !dnd && status === STATUS.IDLE && 'bg-emerald-600 dark:bg-emerald-400',
              !dnd && (status === STATUS.ON_CALL || status === STATUS.DIALING || status === STATUS.INCOMING) &&
                'bg-primary motion-safe:animate-pulse',
              status === STATUS.CONNECTING && 'bg-muted-foreground motion-safe:animate-pulse',
            )}
          />
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.1em]">
            {statusLabel[status]}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!inCall && (
            <button
              type="button"
              onClick={() => setDnd(prev => !prev)}
              aria-pressed={dnd}
              aria-label={dnd ? 'Disable do not disturb' : 'Enable do not disturb'}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-medium tracking-[0.1em]',
                dnd ? 'border-destructive text-destructive' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Moon size={10} aria-hidden />
              {dnd ? 'ON' : 'OFF'}
            </button>
          )}
          <span className="text-[11px] text-muted-foreground">Cornerstone</span>
          {inCall && (
            <button
              type="button"
              onClick={() => setMinimized(true)}
              aria-label="Minimize active call"
              className="text-muted-foreground hover:text-foreground"
            >
              <Minus size={15} aria-hidden />
            </button>
          )}
        </div>
      </header>

      {/* ── wrap-up (replaces the body so notes can't be lost) ───────── */}
      {wrapUp && (
        <section className="px-4 py-4" aria-label="Call wrap-up">
          <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Call ended · {formatDuration(wrapUp.durationSeconds)} · {wrapUp.direction}
          </p>
          <p className="mt-2 font-serif text-xl leading-tight">
            {wrapUp.entry?.name ?? formatPhone(wrapUp.participantNumber) ?? 'Unknown caller'}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {wrapUp.entry?.matterNumber
              ? `Logging to ${wrapUp.entry.matterNumber}`
              : wrapUp.entry
                ? 'Logging to lead record'
                : 'No matching client — saved to the call log'}
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

          <label className="mt-3 block">
            <span className="sr-only">Call notes</span>
            <textarea
              value={wrapUpNotes}
              onChange={e => setWrapUpNotes(e.target.value)}
              rows={4}
              placeholder="Call notes…"
              className="w-full resize-y rounded-[10px] border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed outline-none focus:border-primary"
            />
          </label>

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
          <p className="mt-3 font-serif text-[22px] leading-tight">
            {incomingEntry?.name ?? formatPhone(incomingFrom) ?? incomingFrom}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{formatPhone(incomingFrom) || incomingFrom}</p>
          {incomingEntry?.matterNumber && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[10px]">
              <span className="h-[5px] w-[5px] rounded-full bg-primary" aria-hidden />
              {incomingEntry.matterNumber}
              {incomingEntry.practiceArea ? ` · ${incomingEntry.practiceArea}` : ''}
            </p>
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
              Accept
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
          <p className="mt-4 font-serif text-xl leading-tight">
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
              <p className="truncate font-serif text-lg leading-tight">
                {activeEntry?.name ?? formatPhone(participantRef.current)}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {activeEntry?.matterNumber ?? formatPhone(participantRef.current)}
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
              disabled={providerRef.current !== 'telnyx'}
              title={providerRef.current !== 'telnyx' ? 'Hold requires the Telnyx line' : undefined}
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
                  <span className="font-serif text-xl leading-none">{digit}</span>
                  <span className="min-h-[7px] text-[7px] font-medium tracking-[0.16em] text-muted-foreground">
                    {letters}
                  </span>
                </button>
              ))}
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
          <div className="flex items-baseline gap-2 border-b border-border pb-2.5">
            <input
              ref={numberInputRef}
              className="min-h-[29px] min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-2xl outline-none placeholder:text-lg placeholder:text-muted-foreground"
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
                  {dialedEntry.matterNumber ?? 'Lead'}
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
                <span className="font-serif text-xl leading-none">{digit}</span>
                <span className="min-h-[7px] text-[7px] font-medium tracking-[0.16em] text-muted-foreground">
                  {letters}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <a
              href={dialedEntry?.matterId ? `/admin/matters/${dialedEntry.matterId}` : undefined}
              aria-disabled={!dialedEntry?.matterId}
              className={cn(
                'grid w-11 place-items-center rounded-[10px] border border-border text-[10px] font-medium tracking-[0.08em] text-muted-foreground',
                dialedEntry?.matterId ? 'hover:text-foreground' : 'pointer-events-none opacity-40',
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

      {error && (
        <p
          role="alert"
          onClick={() => setError(null)}
          className="cursor-pointer border-t border-border bg-destructive/10 px-4 py-2 text-center text-[11px] text-destructive"
        >
          {error} — tap to dismiss
        </p>
      )}
    </div>
  )
}
