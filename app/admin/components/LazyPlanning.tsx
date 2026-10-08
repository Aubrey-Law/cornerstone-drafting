'use client'
import { useState, type ReactNode } from 'react'
/** Collapsed planning cards do not mount their fetch effects until opened. */
export function LazyPlanning({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false)
  return <details className="group mt-4 rounded-xl border border-border bg-card" onToggle={event => { if(event.currentTarget.open) setOpened(true) }}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium marker:content-none">
      <span>Planning and context</span><span className="text-xs text-muted-foreground group-open:hidden">Show</span><span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
    </summary>
    {opened && children}
  </details>
}
