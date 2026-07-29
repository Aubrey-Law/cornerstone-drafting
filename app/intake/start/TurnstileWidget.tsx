'use client'

import Script from 'next/script'
import { useEffect, useId, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string) => void
}) {
  const elementId = `turnstile-${useId().replace(/:/g, '')}`
  const widgetId = useRef<string | null>(null)

  function renderWidget() {
    const element = document.getElementById(elementId)
    if (!element || !window.turnstile || widgetId.current) return
    widgetId.current = window.turnstile.render(element, {
      sitekey: siteKey,
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
      theme: 'auto',
    })
  }

  useEffect(() => () => {
    if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
  }, [])

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderWidget}
      />
      <div id={elementId} ref={() => { if (window.turnstile) renderWidget() }} />
    </>
  )
}
