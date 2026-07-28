'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Publishes the live call from the softphone pane up to the admin shell.
 *
 * The device (Twilio `Device` / Telnyx `TelnyxRTC`) stays inside
 * `Softphone.tsx` and stays mounted for the whole admin session — the rail
 * hides the pane with CSS rather than unmounting it, so nothing tears down.
 * What the shell needs is only what it renders: the minimized call bar and the
 * live dot on the Phone tab. That travels through this context.
 */

export interface SoftphoneCallSnapshot {
  /** True while dialing or connected — the window in which a pill makes sense. */
  active: boolean
  connected: boolean
  muted: boolean
  held: boolean
  seconds: number
  /** Directory name when the number resolved, otherwise the formatted number. */
  name: string
  statusLabel: string
  /** True while the wrap-up form is waiting on the operator — the rail restores itself. */
  wrapUpPending: boolean
}

export interface SoftphoneControls {
  toggleMute: () => void
  hangUp: () => void
}

export const EMPTY_CALL_SNAPSHOT: SoftphoneCallSnapshot = {
  active: false,
  connected: false,
  muted: false,
  held: false,
  seconds: 0,
  name: '',
  statusLabel: '',
  wrapUpPending: false,
}

interface SoftphoneContextValue {
  /** False when the firm has no voice provider configured — no rail phone. */
  voiceEnabled: boolean
  call: SoftphoneCallSnapshot
  controls: SoftphoneControls | null
  publish: (snapshot: SoftphoneCallSnapshot, controls: SoftphoneControls) => void
}

const noop = () => {}

const SoftphoneContext = createContext<SoftphoneContextValue>({
  voiceEnabled: false,
  call: EMPTY_CALL_SNAPSHOT,
  controls: null,
  publish: noop,
})

function sameSnapshot(a: SoftphoneCallSnapshot, b: SoftphoneCallSnapshot): boolean {
  return (
    a.active === b.active &&
    a.connected === b.connected &&
    a.muted === b.muted &&
    a.held === b.held &&
    a.seconds === b.seconds &&
    a.name === b.name &&
    a.statusLabel === b.statusLabel &&
    a.wrapUpPending === b.wrapUpPending
  )
}

export function SoftphoneProvider({
  children,
  voiceEnabled = false,
}: {
  children: ReactNode
  voiceEnabled?: boolean
}) {
  const [call, setCall] = useState<SoftphoneCallSnapshot>(EMPTY_CALL_SNAPSHOT)
  // Controls change identity on nearly every render of the pane; keeping them
  // in a ref means the timer ticking doesn't re-render every consumer twice.
  const controlsRef = useRef<SoftphoneControls | null>(null)

  const publish = useCallback((snapshot: SoftphoneCallSnapshot, controls: SoftphoneControls) => {
    controlsRef.current = controls
    setCall(prev => (sameSnapshot(prev, snapshot) ? prev : snapshot))
  }, [])

  // A stable façade: consumers keep one identity while the pane re-publishes
  // its handlers on every render.
  const controls = useMemo<SoftphoneControls>(
    () => ({
      toggleMute: () => controlsRef.current?.toggleMute(),
      hangUp: () => controlsRef.current?.hangUp(),
    }),
    [],
  )

  const value = useMemo<SoftphoneContextValue>(
    () => ({ voiceEnabled, call, controls, publish }),
    [voiceEnabled, call, controls, publish],
  )

  return <SoftphoneContext.Provider value={value}>{children}</SoftphoneContext.Provider>
}

/** True when the rail can place calls; false falls back to plain `tel:` links. */
export function useVoiceEnabled(): boolean {
  return useContext(SoftphoneContext).voiceEnabled
}

/** Read the live call — returns the empty snapshot when no provider is mounted. */
export function useSoftphoneCall(): { call: SoftphoneCallSnapshot; controls: SoftphoneControls | null } {
  const { call, controls } = useContext(SoftphoneContext)
  return { call, controls }
}

/** Used by the softphone pane to keep the shell's copy of the call in sync. */
export function usePublishSoftphoneCall(
  snapshot: SoftphoneCallSnapshot,
  controls: SoftphoneControls,
) {
  const { publish } = useContext(SoftphoneContext)
  const controlsRef = useRef(controls)

  useEffect(() => {
    controlsRef.current = controls
  })

  useEffect(() => {
    publish(snapshot, controlsRef.current)
  }, [publish, snapshot])
}
