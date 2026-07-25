'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Device, Call as TwilioCall } from '@twilio/voice-sdk'
import { TelnyxRTC, type Call as TelnyxCall } from '@telnyx/webrtc'
import { Mic, MicOff, Minus, Moon, PhoneOff } from 'lucide-react'

/**
 * Browser-based dialer for Cornerstone staff. Authenticates via /api/token,
 * places outbound calls through the TwiML App's Voice URL (/api/voice),
 * and accepts inbound calls routed to <Client>identity</Client>.
 *
 * Inbound ringing is active when the business-line Voice URL points at
 * /api/voice/inbound and TWILIO_INBOUND_CLIENT_IDENTITIES includes this user.
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

const KEYPAD: [string, string][] = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
]

export default function Softphone() {
  const [status, setStatus] = useState<SoftphoneStatus>(STATUS.CONNECTING)
  const [number, setNumber] = useState('')
  const [muted, setMuted] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [wrapUpOpen, setWrapUpOpen] = useState(false)
  const [wrapUpNotes, setWrapUpNotes] = useState('')
  const [wrapUpOutcome, setWrapUpOutcome] = useState('Reached')
  const [lastDuration, setLastDuration] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [incomingFrom, setIncomingFrom] = useState('')

  const providerRef = useRef<'twilio' | 'telnyx'>('twilio')
  const deviceRef = useRef<Device | TelnyxRTC | null>(null)
  const callRef = useRef<TwilioCall | TelnyxCall | null>(null)
  const callerNumberRef = useRef<string | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef(0)
  const connectedRef = useRef(false)

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
      setLastDuration(secondsRef.current)
      setWrapUpOpen(true)
      setMinimized(false)
    }
    connectedRef.current = false
    secondsRef.current = 0
    setSeconds(0)
    setMuted(false)
    setIncomingFrom('')
    callRef.current = null
    setStatus(deviceRef.current ? STATUS.IDLE : STATUS.OFFLINE)
  }, [stopTimer])

  const wireTwilioCall = useCallback(
    (call: TwilioCall) => {
      call.on('accept', () => {
        connectedRef.current = true
        setWrapUpOpen(false)
        setStatus(STATUS.ON_CALL)
        setMuted(false)
        startTimer()
      })
      call.on('disconnect', cleanupCall)
      call.on('cancel', cleanupCall)
      call.on('reject', cleanupCall)
      call.on('error', (e: Error) => {
        setError(e?.message || 'Call error')
        cleanupCall()
      })
    },
    [cleanupCall, startTimer],
  )

  const fetchToken = useCallback(async (): Promise<{ provider: 'twilio' | 'telnyx'; token: string; callerNumber?: string | null }> => {
    const res = await fetch('/api/token')
    if (!res.ok) throw new Error('Token request failed')
    return await res.json()
  }, [])

  useEffect(() => {
    let device: Device | TelnyxRTC | undefined
    let refreshTimer: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    void (async () => {
      try {
        const auth = await fetchToken()
        if (cancelled) return
        providerRef.current = auth.provider
        callerNumberRef.current = auth.callerNumber ?? null

        if (auth.provider === 'telnyx') {
          const telnyx = new TelnyxRTC({ login_token: auth.token })
          device = telnyx
          telnyx.on('telnyx.ready', () => setStatus(STATUS.IDLE))
          telnyx.on('telnyx.error', (e: Error) => {
            setError(e?.message || 'Device error')
            setStatus(STATUS.OFFLINE)
          })
          telnyx.on('telnyx.notification', (notification) => {
            if (notification.type !== 'callUpdate' || !notification.call) return
            const call = notification.call
            callRef.current = call
            if (call.state === 'ringing' && call.direction === 'inbound') {
              setIncomingFrom(call.options?.remoteCallerNumber || call.options?.callerNumber || 'Unknown caller')
              setStatus(STATUS.INCOMING)
            } else if (call.state === 'active') {
              connectedRef.current = true
              setWrapUpOpen(false)
              setStatus(STATUS.ON_CALL)
              setMuted(false)
              startTimer()
            } else if (call.state === 'hangup' || call.state === 'destroy') {
              cleanupCall()
            }
          })
          deviceRef.current = telnyx
          await telnyx.connect()
          refreshTimer = setInterval(() => {
            void fetchToken()
              .then(fresh => telnyx.login({ creds: { login_token: fresh.token } }))
              .catch(() => {
                setError('Could not refresh softphone credentials')
              })
          }, 50 * 60 * 1000)
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
          setIncomingFrom(call.parameters?.From || 'Unknown caller')
          setStatus(STATUS.INCOMING)
          wireTwilioCall(call)
        })

        twilioDevice.on('tokenWillExpire', async () => {
          try {
            const fresh = await fetchToken()
            twilioDevice.updateToken(fresh.token)
          } catch {
            /* surfaces as device error if refresh actually fails */
          }
        })

        await twilioDevice.register()
        deviceRef.current = twilioDevice
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Could not start softphone'
          setError(message)
          setStatus(STATUS.OFFLINE)
        }
      }
    })()

    return () => {
      cancelled = true
      if (refreshTimer) clearInterval(refreshTimer)
      stopTimer()
      if (device instanceof Device) device.destroy()
      else device?.disconnect()
    }
  }, [cleanupCall, fetchToken, startTimer, stopTimer, wireTwilioCall])

  const placeCall = useCallback(async () => {
    const device = deviceRef.current
    if (!device || dnd || number.replace(/\D/g, '').length < 10) return
    try {
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
      const message = e instanceof Error ? e.message : 'Could not place call'
      setError(message)
      cleanupCall()
    }
  }, [dnd, number, wireTwilioCall, cleanupCall])

  const acceptCall = useCallback(() => {
    const call = callRef.current
    if (!call) return
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

  const pressKey = useCallback(
    (digit: string) => {
      if (status === STATUS.ON_CALL || status === STATUS.DIALING) {
        const call = callRef.current
        if (providerRef.current === 'telnyx') (call as TelnyxCall | null)?.dtmf(digit)
        else (call as TwilioCall | null)?.sendDigits(digit)
        return
      }
      setNumber((prev) => formatPhone(prev.replace(/\D/g, '') + digit))
    },
    [status],
  )

  const backspace = useCallback(() => {
    setNumber((prev) => formatPhone(prev.replace(/\D/g, '').slice(0, -1)))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (status !== STATUS.IDLE && status !== STATUS.DIALING) return
      if (/^[0-9*#]$/.test(e.key)) pressKey(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter' && !dnd) void placeCall()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dnd, status, pressKey, backspace, placeCall])

  const inCall = status === STATUS.ON_CALL || status === STATUS.DIALING
  const canDial = status === STATUS.IDLE && !dnd && number.replace(/\D/g, '').length >= 10
  const statusLabel: Record<SoftphoneStatus, string> = {
    [STATUS.CONNECTING]: 'Connecting…',
    [STATUS.IDLE]: 'Ready',
    [STATUS.INCOMING]: 'Incoming call',
    [STATUS.DIALING]: 'Calling…',
    [STATUS.ON_CALL]: formatDuration(seconds),
    [STATUS.OFFLINE]: 'Offline',
  }

  if (minimized && inCall) {
    return (
      <button type="button" className="sp-bubble" onClick={() => setMinimized(false)} aria-label="Open active call">
        <style>{styles}</style>
        <span className="sp-bubble__dot" aria-hidden />
        <span>{statusLabel[status]}</span>
      </button>
    )
  }

  return (
    <div className="sp">
      <audio ref={remoteAudioRef} autoPlay />
      <style>{styles}</style>

      <header className="sp__bar">
        <span className={`sp__dot sp__dot--${status}`} aria-hidden />
        <span className="sp__status">{statusLabel[status]}</span>
        <span className="sp__brand">Cornerstone</span>
        {inCall && (
          <button type="button" className="sp__icon" onClick={() => setMinimized(true)} aria-label="Minimize active call">
            <Minus size={15} />
          </button>
        )}
      </header>

      {status === STATUS.INCOMING && (
        <div className="sp__incoming" role="dialog" aria-label="Incoming call">
          <p className="sp__incoming-label">Incoming</p>
          <p className="sp__incoming-from">{formatPhone(incomingFrom) || incomingFrom}</p>
          <div className="sp__incoming-actions">
            <button type="button" className="sp__btn sp__btn--decline" onClick={rejectCall}>
              Decline
            </button>
            <button type="button" className="sp__btn sp__btn--accept" onClick={acceptCall}>
              Answer
            </button>
          </div>
        </div>
      )}

      <div className="sp__readout" aria-live="polite">
        {inCall ? (
          <span className="sp__readout-num">{formatPhone(number) || 'Call in progress'}</span>
        ) : (
          <input
            className="sp__readout-input"
            value={number}
            onChange={(e) => setNumber(formatPhone(e.target.value))}
            placeholder="Enter a number"
            inputMode="tel"
            aria-label="Phone number"
            disabled={status === STATUS.INCOMING}
          />
        )}
        {!inCall && number && (
          <button type="button" className="sp__back" onClick={backspace} aria-label="Delete last digit">
            ⌫
          </button>
        )}
      </div>

      <div className="sp__pad" role="group" aria-label="Dial pad">
        {KEYPAD.map(([digit, letters]) => (
          <button
            key={digit}
            type="button"
            className="sp__key"
            onClick={() => pressKey(digit)}
            disabled={status === STATUS.INCOMING}
          >
            <span className="sp__key-digit">{digit}</span>
            <span className="sp__key-letters">{letters}</span>
          </button>
        ))}
      </div>

      <div className="sp__actions">
        {inCall ? (
          <>
            <button
              type="button"
              className={`sp__round ${muted ? 'sp__round--on' : ''}`}
              onClick={toggleMute}
              disabled={status !== STATUS.ON_CALL}
              aria-pressed={muted}
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              <span>{muted ? 'Unmute' : 'Mute'}</span>
            </button>
            <button type="button" className="sp__round sp__round--end" onClick={hangUp}>
              <PhoneOff size={16} />
              <span>End</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`sp__round sp__round--dnd ${dnd ? 'sp__round--on' : ''}`}
              onClick={() => setDnd((prev) => !prev)}
              aria-pressed={dnd}
              aria-label={dnd ? 'Disable do not disturb' : 'Enable do not disturb'}
            >
              <Moon size={16} />
              <span>DND</span>
            </button>
            <button
              type="button"
              className="sp__round sp__round--call"
              onClick={() => void placeCall()}
              disabled={!canDial}
            >
              Call
            </button>
          </>
        )}
      </div>

      {wrapUpOpen && !inCall && (
        <section className="sp__wrap" aria-label="Call wrap-up">
          <div className="sp__wrap-head">
            <div>
              <h2>Call wrap-up</h2>
              <p>{formatDuration(lastDuration)} call</p>
            </div>
            <button type="button" className="sp__wrap-close" onClick={() => setWrapUpOpen(false)}>
              Done
            </button>
          </div>
          <label className="sp__field">
            <span>Outcome</span>
            <select value={wrapUpOutcome} onChange={(e) => setWrapUpOutcome(e.target.value)}>
              <option>Reached</option>
              <option>Voicemail</option>
              <option>No answer</option>
            </select>
          </label>
          <label className="sp__field">
            <span>Call notes</span>
            <textarea value={wrapUpNotes} onChange={(e) => setWrapUpNotes(e.target.value)} rows={3} />
          </label>
        </section>
      )}

      {error && (
        <p className="sp__error" role="alert" onClick={() => setError(null)}>
          {error} — tap to dismiss
        </p>
      )}
    </div>
  )
}

const styles = `
.sp {
  --navy: #1B3A6B;
  --teal: #0F6E56;
  --ink: #14223b;
  --line: #e4e8f0;
  --bg: #fbfcfe;
  --muted: #7d8aa3;
  width: 320px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 16px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
  box-shadow: 0 12px 32px -16px rgba(27,58,107,.35);
  position: relative;
  user-select: none;
}
.sp__bar {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; margin-bottom: 14px;
}
.sp__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.sp__dot--idle { background: var(--teal); }
.sp__dot--on_call { background: var(--teal); animation: pulse 1.6s infinite; }
.sp__dot--dialing, .sp__dot--incoming { background: #d98a00; animation: pulse 1s infinite; }
.sp__dot--offline { background: #c0392b; }
.sp__dot--connecting { background: var(--muted); animation: pulse 1.2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.sp__status { font-variant-numeric: tabular-nums; font-weight: 600; }
.sp__brand { margin-left: auto; color: var(--navy); font-weight: 700; letter-spacing: .2px; }
.sp__icon {
  width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: var(--muted); cursor: pointer;
}
.sp__icon:hover { color: var(--navy); background: #f3f6fb; }

.sp__readout {
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid var(--line);
  padding: 6px 2px 12px; margin-bottom: 14px; min-height: 40px;
}
.sp__readout-input {
  flex: 1; border: 0; background: transparent; outline: none;
  font-size: 24px; letter-spacing: .5px; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.sp__readout-input::placeholder { color: var(--muted); font-size: 17px; letter-spacing: 0; }
.sp__readout-num { flex: 1; font-size: 22px; color: var(--navy); font-weight: 600; }
.sp__back { border: 0; background: transparent; font-size: 18px; color: var(--muted); cursor: pointer; padding: 4px 8px; }
.sp__back:hover { color: var(--navy); }

.sp__pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sp__key {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 56px; border: 1px solid var(--line); border-radius: 12px;
  background: #fff; cursor: pointer; transition: transform .06s, background .12s, border-color .12s;
}
.sp__key:hover { background: #f3f6fb; border-color: #cdd6e6; }
.sp__key:active { transform: scale(.96); background: #eef2f9; }
.sp__key:disabled { opacity: .4; cursor: not-allowed; }
.sp__key-digit { font-size: 22px; font-weight: 600; color: var(--ink); line-height: 1; }
.sp__key-letters { font-size: 9px; letter-spacing: 1.5px; color: var(--muted); margin-top: 3px; min-height: 11px; }

.sp__actions { display: flex; justify-content: center; gap: 14px; margin-top: 16px; }
.sp__round {
  min-width: 110px; height: 48px; border: 0; border-radius: 24px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  font-size: 15px; font-weight: 600; color: #fff; cursor: pointer;
  transition: filter .12s, transform .06s;
}
.sp__round:active { transform: scale(.97); }
.sp__round:disabled { opacity: .45; cursor: not-allowed; }
.sp__round--call { background: var(--teal); }
.sp__round--end { background: #c0392b; }
.sp__round--on { background: var(--navy); }
.sp__round--dnd { background: var(--muted); }
.sp__round:not(.sp__round--call):not(.sp__round--end):not(.sp__round--on) { background: var(--muted); }
.sp__round:hover:not(:disabled) { filter: brightness(1.06); }

.sp__wrap {
  margin-top: 14px; padding-top: 13px; border-top: 1px solid var(--line);
  display: grid; gap: 10px;
}
.sp__wrap-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.sp__wrap h2 { margin: 0; font-size: 15px; color: var(--ink); }
.sp__wrap p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.sp__wrap-close {
  border: 1px solid var(--line); background: #fff; color: var(--navy); border-radius: 8px;
  height: 30px; padding: 0 10px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.sp__field { display: grid; gap: 5px; font-size: 12px; font-weight: 700; color: var(--ink); }
.sp__field select,
.sp__field textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #fff;
  color: var(--ink); font: inherit; font-weight: 500; padding: 8px 9px; outline: none;
}
.sp__field textarea { resize: vertical; min-height: 74px; }
.sp__field select:focus,
.sp__field textarea:focus { border-color: var(--navy); box-shadow: 0 0 0 2px rgba(27,58,107,.12); }

.sp-bubble {
  --navy: #1B3A6B;
  --teal: #0F6E56;
  --line: #e4e8f0;
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; min-width: 118px; padding: 0 14px;
  border: 1px solid var(--line); border-radius: 22px; background: #fff;
  color: var(--navy); font: 700 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 12px 32px -16px rgba(27,58,107,.35); cursor: pointer;
}
.sp-bubble__dot { width: 9px; height: 9px; border-radius: 50%; background: var(--teal); animation: pulse 1.6s infinite; }

.sp__incoming {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(251,252,254,.97); border-radius: 18px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  animation: rise .18s ease-out;
}
@keyframes rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.sp__incoming-label { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); }
.sp__incoming-from { font-size: 22px; font-weight: 700; color: var(--navy); margin-bottom: 18px; }
.sp__incoming-actions { display: flex; gap: 14px; }
.sp__btn { min-width: 104px; height: 46px; border: 0; border-radius: 23px; font-size: 15px; font-weight: 600; color: #fff; cursor: pointer; }
.sp__btn--accept { background: var(--teal); }
.sp__btn--decline { background: #c0392b; }
.sp__btn:active { transform: scale(.97); }

.sp__error {
  margin: 12px 0 0; padding: 8px 10px; font-size: 12px;
  background: #fdecea; color: #a13226; border-radius: 8px; cursor: pointer; text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .sp__dot, .sp__incoming { animation: none; }
  .sp__round:active, .sp__key:active, .sp__btn:active { transform: none; }
}
`
