'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Phone, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Softphone = dynamic(() => import('@/components/softphone/Softphone'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-[320px] items-center justify-center rounded-[18px] border border-border bg-card text-sm text-muted-foreground">
      Loading phone…
    </div>
  ),
})

export function StaffSoftphone() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      const fab = document.getElementById('staff-softphone-fab')
      if (fab?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-20 right-20 z-50"
          role="dialog"
          aria-label="Softphone"
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -right-2 -top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
              aria-label="Close softphone"
            >
              <X size={14} />
            </button>
            <Softphone />
          </div>
        </div>
      )}

      <button
        id="staff-softphone-fab"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Close softphone' : 'Open softphone'}
        aria-expanded={open}
        className={cn(
          'fixed bottom-6 right-20 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          open
            ? 'bg-accent text-accent-foreground'
            : 'bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Phone size={22} strokeWidth={2} />
      </button>
    </>
  )
}
