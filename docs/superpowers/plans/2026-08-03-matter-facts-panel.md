# Matter Detail Left Facts Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the matter detail left rail's contents with a 352px inline-editable facts panel — identity header plus six collapsible sections (Contact, Spouse, Matter details, Dates, Notes, Activity) — matching mockup option `5a`.

**Architecture:** A new `facts-panel/` folder under `app/admin/matters/[id]/`, composed of small focused files: a section shell, inline field primitives, a localStorage hook, an activity list, and the panel that wires them together. Two write paths already exist and are reused — `onSaveField` (matter_details) and `PATCH /api/admin/matters/[id]/contacts` (client_intake + contacts). The activity icon/label maps move out of `MatterActivityTab.tsx` into a shared module so both surfaces render events identically.

**Tech Stack:** Next.js App Router client components, TypeScript, Tailwind v4 + shadcn/ui primitives, lucide-react, Vitest + Testing Library (jsdom).

**Decisions taken with the user (2026-08-03):**
1. **Placement** — keep the existing persistent `ResponsiveDetailRail` and widen it from `w-80` to 352px. The rail already sits on the left and shows on every tab; moving the panel into the Overview grid would hide it on Tasks/Documents/Communications. The prompt's "right-hand rail" premise is stale.
2. **Allowlist** — extend `CLIENT_FIELDS` in the existing contacts route with `full_name`, `marital_status`, `has_minor_children` (no new route) so the header name, marital status and minor children save.
3. **Contact data** — the panel fetches `GET /api/admin/matters/[id]/contacts` on mount for the client intake row and the spouse contact id, with a skeleton for those sections while loading.

**Deviation from the prompt, deliberate:** marital status renders as the header sub-line select only (as in mockup `5a`), not also as a Contact row. One field, one control.

**Run tests with:** `npx vitest run <path>`.

**Baseline:** `npm test` currently has one pre-existing failure — `lead-detail-interactions › opens the intake sheet for both fill and review ribbon intents`. Do not count it as a regression; do not claim to have fixed it.

---

## File Structure

**Create**
- `app/admin/matters/[id]/activityEventMeta.tsx` — `ACTIVITY_EVENT_LABELS`, `EVENT_META`, `activityEventTitle()`, `draftDocumentCount()`; the single source both activity surfaces read
- `app/admin/matters/[id]/facts-panel/useSectionState.ts` — versioned localStorage open/closed state with default merge
- `app/admin/matters/[id]/facts-panel/PanelSection.tsx` — collapsible card shell (label, summary hint, chevron)
- `app/admin/matters/[id]/facts-panel/InlineField.tsx` — `InlineText`, `InlineSelect`, `InlineDate`, `ReadOnlyRow`
- `app/admin/matters/[id]/facts-panel/PanelActivity.tsx` — 5 most recent events on a timeline spine
- `app/admin/matters/[id]/facts-panel/MatterFactsPanel.tsx` — identity header + six sections, owns the contacts fetch and save orchestration
- `tests/matter-facts-panel.test.tsx`
- `tests/matter-facts-panel-sections.test.tsx`

**Modify**
- `app/admin/matters/[id]/MatterActivityTab.tsx` — import the maps from `activityEventMeta` instead of defining them
- `app/admin/matters/[id]/MatterDetailClient.tsx` — render `MatterFactsPanel` in the rail; widen the rail to 352px; drop the local `MatterFactsRail`/`RailDate` helpers once unused
- `app/api/admin/matters/[id]/contacts/route.ts` — extend `CLIENT_FIELDS`; add the three columns to the GET select

**Delete**
- `app/admin/matters/[id]/MatterOverviewFactsRail.tsx` — after confirming no other importer

---

### Task 1: Extract the activity event maps

**Files:**
- Create: `app/admin/matters/[id]/activityEventMeta.tsx`
- Modify: `app/admin/matters/[id]/MatterActivityTab.tsx`
- Test: `tests/matter-activity-icons.test.tsx` must keep passing (it already covers the maps)

- [ ] **Step 1: Create the shared module**

Move the two maps and the draft-count logic out of `MatterActivityTab.tsx` verbatim, then export them:

```tsx
import { Activity, CheckCircle2, FileText, Info, Send, type LucideIcon } from 'lucide-react'
import type { ActivityEventType, MatterActivity } from '@/types/database'

export const ACTIVITY_EVENT_LABELS: Partial<Record<MatterActivity['event_type'], string>> = {
  intake_sent: 'Intake sent',
  intake_completed: 'Intake completed',
  draft_generated: 'Drafts generated',
  stage_changed: 'Stage changed',
}

export interface EventMeta {
  icon: LucideIcon
  color: string
  label: string
}

export const EVENT_META: Partial<Record<ActivityEventType, EventMeta>> = {
  stage_changed: { icon: Activity, color: 'text-accent bg-accent/10', label: 'Stage changed activity' },
  intake_sent: { icon: Send, color: 'text-accent bg-accent/10', label: 'Intake sent activity' },
  intake_completed: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Intake completed activity' },
  email_sent: { icon: Send, color: 'text-muted-foreground bg-muted', label: 'Email sent activity' },
  draft_generated: { icon: FileText, color: 'text-accent bg-accent/10', label: 'Draft generated activity' },
  draft_promoted_to_review: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Draft promoted to review activity' },
  matter_created: { icon: Info, color: 'text-muted-foreground bg-muted', label: 'Matter activity' },
}

export function eventMetaFor(type: ActivityEventType): EventMeta {
  return EVENT_META[type] ?? EVENT_META.matter_created!
}

export interface DocumentReference {
  id: string
  name: string
}

export function documentReferences(metadata: MatterActivity['metadata']): DocumentReference[] {
  if (!metadata || !Array.isArray(metadata.documentRefs)) return []
  return metadata.documentRefs.filter(
    (value): value is DocumentReference =>
      typeof value === 'object'
      && value !== null
      && typeof (value as Record<string, unknown>).id === 'string'
      && typeof (value as Record<string, unknown>).name === 'string',
  )
}

export function legacyDocumentNames(metadata: MatterActivity['metadata']): string[] {
  return metadata && Array.isArray(metadata.documents)
    ? metadata.documents.filter((value): value is string => typeof value === 'string')
    : []
}

/** Drafts carry their document count in metadata; everything else uses its title. */
export function draftDocumentCount(event: MatterActivity): number {
  if (event.event_type !== 'draft_generated') return 0
  return documentReferences(event.metadata).length || legacyDocumentNames(event.metadata).length
}

export function activityEventTitle(event: MatterActivity): string {
  const drafts = draftDocumentCount(event)
  if (drafts > 0) return `Generated ${drafts} drafts`
  return event.title || ACTIVITY_EVENT_LABELS[event.event_type] || 'Matter updated'
}
```

- [ ] **Step 2: Rewire `MatterActivityTab.tsx`**

Delete its local `ACTIVITY_EVENT_LABELS`, `EventMeta`, `EVENT_META`, `DocumentReference`, `documentReferences`, `legacyDocumentNames`, and the lucide icon imports they used. Import from the new module and replace the inline title expression with `activityEventTitle(item)`:

```tsx
import {
  ACTIVITY_EVENT_LABELS,
  activityEventTitle,
  documentReferences,
  draftDocumentCount,
  eventMetaFor,
  legacyDocumentNames,
} from './activityEventMeta'
```

Inside the map: `const meta = eventMetaFor(item.event_type)`, `const draftCount = draftDocumentCount(item)`, and `<p className="text-sm font-medium">{activityEventTitle(item)}</p>`. Keep `refs`/`legacyNames` for the "Show drafts" list. `ACTIVITY_EVENT_LABELS` stays imported only if still referenced — if not, drop it from the import to keep lint clean.

- [ ] **Step 3: Run the existing activity tests**

Run: `npx vitest run tests/matter-activity-icons.test.tsx tests/matter-activity.test.ts tests/matter-activity-redesign.test.ts`
Expected: PASS, unchanged behaviour.

- [ ] **Step 4: Commit**

```bash
git add "app/admin/matters/[id]/activityEventMeta.tsx" "app/admin/matters/[id]/MatterActivityTab.tsx"
git commit -m "Extract matter activity event maps into a shared module"
```

---

### Task 2: Section open/closed persistence hook

**Files:**
- Create: `app/admin/matters/[id]/facts-panel/useSectionState.ts`
- Test: `tests/matter-facts-panel-sections.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FACTS_PANEL_SECTION_STORAGE_KEY,
  DEFAULT_SECTION_STATE,
  useSectionState,
} from '@/app/admin/matters/[id]/facts-panel/useSectionState'

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('useSectionState', () => {
  it('starts from the defaults when nothing is stored', () => {
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open).toEqual(DEFAULT_SECTION_STATE)
    expect(DEFAULT_SECTION_STATE).toEqual({
      contact: true, spouse: true, matter: true, dates: false, notes: false, activity: false,
    })
  })

  it('round-trips a toggle through localStorage', () => {
    const first = renderHook(() => useSectionState())
    act(() => first.result.current.toggle('dates'))
    expect(first.result.current.open.dates).toBe(true)

    const second = renderHook(() => useSectionState())
    expect(second.result.current.open.dates).toBe(true)
  })

  it('merges a partial stored value with the defaults', () => {
    window.localStorage.setItem(
      FACTS_PANEL_SECTION_STORAGE_KEY,
      JSON.stringify({ notes: true }),
    )
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open.notes).toBe(true)
    expect(result.current.open.contact).toBe(DEFAULT_SECTION_STATE.contact)
  })

  it('ignores unknown keys and malformed json without throwing', () => {
    window.localStorage.setItem(
      FACTS_PANEL_SECTION_STORAGE_KEY,
      JSON.stringify({ contact: false, bogus: true, dates: 'yes' }),
    )
    const { result } = renderHook(() => useSectionState())
    expect(result.current.open.contact).toBe(false)
    expect(result.current.open.dates).toBe(DEFAULT_SECTION_STATE.dates)
    expect('bogus' in result.current.open).toBe(false)
  })

  it('leaves other localStorage keys alone when collapsing all', () => {
    window.localStorage.setItem('al.unrelated', 'keep me')
    const { result } = renderHook(() => useSectionState())
    act(() => result.current.collapseAll())
    expect(Object.values(result.current.open).every(value => value === false)).toBe(true)
    expect(window.localStorage.getItem('al.unrelated')).toBe('keep me')
  })
})
```

- [ ] **Step 2: Run it — expect module-not-found**

Run: `npx vitest run tests/matter-facts-panel-sections.test.tsx`
Expected: FAIL — cannot resolve `useSectionState`.

- [ ] **Step 3: Implement the hook**

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'

export const FACTS_PANEL_SECTION_STORAGE_KEY = 'al.matterRail.openSections.v1'

export type FactsPanelSection = 'contact' | 'spouse' | 'matter' | 'dates' | 'notes' | 'activity'

export type SectionState = Record<FactsPanelSection, boolean>

export const DEFAULT_SECTION_STATE: SectionState = {
  contact: true,
  spouse: true,
  matter: true,
  dates: false,
  notes: false,
  activity: false,
}

const SECTION_KEYS = Object.keys(DEFAULT_SECTION_STATE) as FactsPanelSection[]

/** Merge stored state over the defaults, dropping unknown keys and non-booleans. */
function mergeStored(raw: string | null): SectionState {
  if (!raw) return DEFAULT_SECTION_STATE
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SECTION_STATE
    const merged = { ...DEFAULT_SECTION_STATE }
    for (const key of SECTION_KEYS) {
      if (typeof parsed[key] === 'boolean') merged[key] = parsed[key]
    }
    return merged
  } catch {
    return DEFAULT_SECTION_STATE
  }
}

/**
 * Which panel sections are open, remembered per browser. Hydration is a state
 * flag, not a ref: the persist effect must not run before the restored value
 * lands or it would write the defaults back over it.
 */
export function useSectionState() {
  const [open, setOpen] = useState<SectionState>(DEFAULT_SECTION_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(FACTS_PANEL_SECTION_STORAGE_KEY)
    } catch {
      /* a blocked store just means defaults */
    }
    setOpen(mergeStored(stored))
    setRestored(Boolean(stored))
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(FACTS_PANEL_SECTION_STORAGE_KEY, JSON.stringify(open))
    } catch {
      /* ignore */
    }
  }, [hydrated, open])

  const toggle = useCallback((section: FactsPanelSection) => {
    setOpen(current => ({ ...current, [section]: !current[section] }))
  }, [])

  const collapseAll = useCallback(() => {
    setOpen(SECTION_KEYS.reduce(
      (next, key) => ({ ...next, [key]: false }),
      {} as SectionState,
    ))
  }, [])

  return { open, toggle, collapseAll, hydrated, restored }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/matter-facts-panel-sections.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add "app/admin/matters/[id]/facts-panel/useSectionState.ts" tests/matter-facts-panel-sections.test.tsx
git commit -m "Add persisted section state for the matter facts panel"
```

---

### Task 3: Section shell and inline field primitives

**Files:**
- Create: `app/admin/matters/[id]/facts-panel/PanelSection.tsx`
- Create: `app/admin/matters/[id]/facts-panel/InlineField.tsx`
- Test: covered through the panel tests in Task 5 (these are presentational primitives with no logic of their own beyond edit lifecycle, which Task 5 exercises end to end)

- [ ] **Step 1: `PanelSection.tsx`**

A controlled disclosure — not native `<details>`, because open state lives in the hook:

```tsx
'use client'

import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PanelSection({
  id,
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  /** Right-side summary shown in the header, visible when collapsed. */
  hint?: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-content`}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {title}
          </span>
          <span className="flex items-center gap-2">
            {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
            <ChevronDown
              className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </span>
        </button>
      </h3>
      {open && <div id={`${id}-content`} className="px-2.5 pb-3">{children}</div>}
    </section>
  )
}
```

- [ ] **Step 2: `InlineField.tsx`**

Four exports. `InlineText` carries the edit lifecycle the acceptance criteria name — Enter saves, Escape cancels, blur saves:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

const ROW = 'flex items-center justify-between gap-2.5 rounded-md px-1.5 py-1'
const LABEL = 'text-[11.5px] text-muted-foreground'
const VALUE = 'text-[12.5px]'

export function ReadOnlyRow({
  label,
  children,
  tabular = false,
}: {
  label: string
  children: React.ReactNode
  tabular?: boolean
}) {
  return (
    <div className={ROW}>
      <span className={LABEL}>{label}</span>
      <span className={cn(VALUE, tabular && 'tabular-nums')}>{children}</span>
    </div>
  )
}

export function InlineText({
  label,
  value,
  placeholder = '—',
  tabular = false,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  tabular?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const committed = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    if (committed.current) return
    committed.current = true
    setEditing(false)
    if (draft !== value) void onSave(draft)
  }

  function cancel() {
    committed.current = true
    setDraft(value)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { committed.current = false; setEditing(true) }}
        className={cn(ROW, 'group w-full text-left hover:bg-muted')}
      >
        <span className={LABEL}>{label}</span>
        <span className={cn(VALUE, 'flex items-center gap-1.5', tabular && 'tabular-nums')}>
          {value || placeholder}
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />
        </span>
      </button>
    )
  }

  return (
    <div className={ROW}>
      <label className={LABEL} htmlFor={`field-${label}`}>{label}</label>
      <input
        id={`field-${label}`}
        ref={inputRef}
        aria-label={label}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit() }
          if (event.key === 'Escape') { event.preventDefault(); cancel() }
        }}
        className={cn(
          'h-6.5 w-40 rounded-md border border-input bg-background px-1.5 text-right text-[12.5px] outline-none focus:border-ring',
          tabular && 'tabular-nums',
        )}
      />
    </div>
  )
}

/** Looks like text until hovered; writes on change. */
export function InlineSelect({
  label,
  value,
  options,
  onSave,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onSave: (next: string) => void | Promise<void>
}) {
  return (
    <div className={cn(ROW, 'hover:bg-muted')}>
      <span className={LABEL}>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={event => void onSave(event.target.value)}
        className="h-6.5 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] hover:border-input hover:bg-background focus:border-ring focus:outline-none"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

export function InlineDate({
  label,
  value,
  emphasized = false,
  onSave,
}: {
  label: string
  /** `YYYY-MM-DD` or empty. */
  value: string
  emphasized?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  return (
    <div className={cn(ROW, 'hover:bg-muted')}>
      <span className={cn(LABEL, emphasized && 'font-semibold text-foreground')}>{label}</span>
      <input
        type="date"
        aria-label={label}
        defaultValue={value}
        onBlur={event => { if (event.target.value !== value) void onSave(event.target.value) }}
        className={cn(
          'h-6.5 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] tabular-nums hover:border-input hover:bg-background focus:border-ring focus:outline-none',
          emphasized && 'border-input bg-background font-semibold text-accent',
        )}
      />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.typecheck.json 2>&1 | grep facts-panel`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "app/admin/matters/[id]/facts-panel/PanelSection.tsx" "app/admin/matters/[id]/facts-panel/InlineField.tsx"
git commit -m "Add section shell and inline field primitives for the facts panel"
```

---

### Task 4: Server — extend the contacts allowlist

**Files:**
- Modify: `app/api/admin/matters/[id]/contacts/route.ts`
- Test: `tests/matter-facts-panel.test.tsx` covers the client side; add the route assertions to `tests/matter-contacts-route.test.ts` if it exists, otherwise assert inside the panel test that the PATCH body carries the field

- [ ] **Step 1: Extend `CLIENT_FIELDS`**

```ts
const CLIENT_FIELDS = new Set([
  'first_name', 'middle_name', 'last_name', 'email', 'phone',
  'address_line1', 'city', 'state', 'zip',
  'suffix', 'preferred_name', 'preferred_pronoun', 'date_of_birth',
  // Editable from the matter facts panel's identity header and Contact section.
  'full_name', 'marital_status', 'has_minor_children',
])
```

- [ ] **Step 2: Return the three columns from GET**

In the `client_intake` select inside `GET`, add them so the panel can render what it can now write:

```ts
      .select('id, first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, date_of_birth, email, phone, address_line1, city, state, zip, full_name, marital_status, has_minor_children')
```

- [ ] **Step 3: Verify the empty-string coercion is right for booleans**

The route already maps `v === '' ? null : v`, so `has_minor_children: false` passes through untouched. No change needed — confirm by reading the loop, do not "fix" it.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/matters/[id]/contacts/route.ts"
git commit -m "Allow name, marital status and minor children edits from the matter panel"
```

---

### Task 5: The panel

**Files:**
- Create: `app/admin/matters/[id]/facts-panel/PanelActivity.tsx`
- Create: `app/admin/matters/[id]/facts-panel/MatterFactsPanel.tsx`
- Test: `tests/matter-facts-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Cover the acceptance criteria: every label present, spouse hidden when unmarried, save wiring, Escape revert, fee-status options and values, activity rendering.

```tsx
// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))
vi.mock('@/components/softphone/SoftphoneProvider', () => ({ useVoiceEnabled: () => false }))

import { MatterFactsPanel } from '@/app/admin/matters/[id]/facts-panel/MatterFactsPanel'
import type { PipelineMatter } from '@/types/database'
import type { MatterActivity } from '@/types/database'

const CONTACTS_PAYLOAD = {
  client: {
    id: 'intake-1',
    first_name: 'Margaret', middle_name: 'A', last_name: 'Chen',
    full_name: 'Margaret A. Chen',
    email: 'margaret.chen@example.com',
    phone: '(617) 555-0184',
    address_line1: '42 Larchmont Rd', city: 'Newton', state: 'MA', zip: '02459',
    date_of_birth: '1958-04-12',
    marital_status: 'married',
    has_minor_children: false,
  },
  contacts: [
    {
      id: 'contact-spouse',
      relationship_type: 'spouse',
      first_name: 'Robert', last_name: 'Chen',
      email: 'robert.chen@example.com',
      phone: '(617) 555-0199',
      date_of_birth: null,
      role_labels: [],
    },
  ],
}

const ESTATE = {
  assetCount: 3,
  ownedAssetValue: 3_000_000,
  deathBenefit: 420_000,
  grossEstateEstimate: 3_420_000,
  totalDebt: 0,
  netInventoryValue: 3_420_000,
  estimatedMaTax: 118_400,
  latestAssetUpdatedAt: '2026-07-09T00:00:00.000Z',
}

const ACTIVITY: MatterActivity[] = [
  {
    id: 'a1', matter_id: 'm-1', event_type: 'draft_generated',
    title: null, detail: null, actor_name: 'Scott Aubrey',
    created_at: '2026-07-28T19:12:00.000Z',
    metadata: { documentRefs: [
      { id: 'd1', name: 'Trust.docx' }, { id: 'd2', name: 'Will.docx' },
      { id: 'd3', name: 'POA.docx' }, { id: 'd4', name: 'HCP.docx' },
    ] },
  } as unknown as MatterActivity,
  {
    id: 'a2', matter_id: 'm-1', event_type: 'matter_created',
    title: 'Matter created', detail: null, actor_name: null,
    created_at: '2026-06-18T13:02:00.000Z',
    metadata: { origin: 'lead' },
  } as unknown as MatterActivity,
]

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'm-1',
    matter_name: 'Chen Trust',
    client_name: 'Margaret A. Chen',
    client_email: 'margaret.chen@example.com',
    client_phone: '(617) 555-0184',
    client_dob: '1958-04-12',
    client_address: '42 Larchmont Rd, Newton, MA 02459',
    spouse_name: 'Robert J. Chen',
    spouse_email: 'robert.chen@example.com',
    spouse_phone: '(617) 555-0199',
    marital_status: 'married',
    has_minor_children: false,
    stage: 'drafting',
    referral_source: 'Referral — Dr. Alvarez',
    fee_amount: 4800,
    ...overrides,
  } as PipelineMatter
}

const DETAILS = {
  practice_area: 'EP',
  plan_type: 'Trust Plan',
  referral_source: 'Referral — Dr. Alvarez',
  flat_fee_amount: 4800,
  fee_payment_status: 'deposit' as const,
  ep_ma_estate_taxable: true,
  urgency: 'high',
  intake_date: '2026-06-18',
  engagement_signed_at: '2026-06-24T00:00:00.000Z',
  design_meeting_date: '2026-07-09',
  scheduled_signing_date: '2026-08-21T12:00:00.000Z',
}

function renderPanel(props: Partial<React.ComponentProps<typeof MatterFactsPanel>> = {}) {
  const onSaveField = props.onSaveField ?? vi.fn().mockResolvedValue(undefined)
  render(
    <MatterFactsPanel
      matter={props.matter ?? matter()}
      matterId="m-1"
      details={props.details ?? DETAILS}
      designSheetPlanType={null}
      estate={ESTATE}
      activity={props.activity ?? ACTIVITY}
      noteText=""
      onNoteTextChange={vi.fn()}
      onAddNote={vi.fn()}
      noteSaving={false}
      noteCount={3}
      latestNoteAt="2026-07-09T00:00:00.000Z"
      onSaveField={onSaveField}
      savingField={null}
      lastSavedAt={null}
      error={null}
      onOpenTab={vi.fn()}
      {...props}
    />,
  )
  return { onSaveField }
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/contacts')) {
      return { ok: true, json: async () => CONTACTS_PAYLOAD } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('MatterFactsPanel', () => {
  it('renders every section label', async () => {
    renderPanel()
    for (const label of ['Contact', 'Spouse', 'Matter details', 'Dates', 'Notes', 'Activity']) {
      expect(await screen.findByRole('button', { name: new RegExp(label, 'i') })).toBeTruthy()
    }
  })

  it('renders the contact and matter field labels', async () => {
    renderPanel()
    await screen.findByText('margaret.chen@example.com')
    for (const label of ['Email', 'Phone', 'Address', 'Date of birth', 'Minor children']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    for (const label of ['Practice area', 'Plan', 'Lead source', 'Flat fee']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('hides the Spouse section when the client is not married', async () => {
    renderPanel({ matter: matter({ marital_status: 'single' }) })
    await screen.findByRole('button', { name: /contact/i })
    expect(screen.queryByRole('button', { name: /^spouse/i })).toBeNull()
  })

  it('shows the age beside the date of birth', async () => {
    renderPanel()
    expect(await screen.findByText(/Apr 12, 1958/)).toBeTruthy()
  })

  it('offers exactly the three fee statuses and saves the stored value', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    const select = await screen.findByLabelText('Fee status')
    expect([...select.querySelectorAll('option')].map(o => o.textContent)).toEqual([
      'Unpaid', 'Deposit', 'Paid in full',
    ])
    await user.selectOptions(select, 'paid_in_full')
    expect(onSaveField).toHaveBeenCalledWith('fee_payment_status', 'paid_in_full')
  })

  it('saves a matter details field through onSaveField', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    const row = await screen.findByRole('button', { name: /Lead source/ })
    await user.click(row)
    const input = screen.getByLabelText('Lead source')
    await user.clear(input)
    await user.type(input, 'Seminar{Enter}')
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith('referral_source', 'Seminar'))
  })

  it('reverts on Escape without saving', async () => {
    const user = userEvent.setup()
    const { onSaveField } = renderPanel()
    const row = await screen.findByRole('button', { name: /Lead source/ })
    await user.click(row)
    const input = screen.getByLabelText('Lead source')
    await user.clear(input)
    await user.type(input, 'Nope{Escape}')
    expect(onSaveField).not.toHaveBeenCalled()
    expect(await screen.findByText('Referral — Dr. Alvarez')).toBeTruthy()
  })

  it('saves a contact field through the contacts route', async () => {
    const user = userEvent.setup()
    renderPanel()
    const row = await screen.findByRole('button', { name: /Email/ })
    await user.click(row)
    const input = screen.getByLabelText('Email')
    await user.clear(input)
    await user.type(input, 'new@example.com{Enter}')

    await waitFor(() => {
      const patch = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({
        target: 'client',
        patch: { email: 'new@example.com' },
      })
    })
  })

  it('renders activity with the shared labels and the From lead pill', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: /activity/i }))
    expect(await screen.findByText('Generated 4 drafts')).toBeTruthy()
    expect(screen.getByText('Matter created')).toBeTruthy()
    expect(screen.getByText('From lead')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Draft generated activity' })).toBeTruthy()
  })

  it('collapses every section from Collapse all', async () => {
    const user = userEvent.setup()
    renderPanel()
    const contact = await screen.findByRole('button', { name: /contact/i })
    expect(contact.getAttribute('aria-expanded')).toBe('true')
    await user.click(screen.getByRole('button', { name: /collapse all/i }))
    expect(contact.getAttribute('aria-expanded')).toBe('false')
  })
})
```

- [ ] **Step 2: Run it — expect module-not-found**

Run: `npx vitest run tests/matter-facts-panel.test.tsx`
Expected: FAIL — cannot resolve `MatterFactsPanel`.

- [ ] **Step 3: Build `PanelActivity.tsx`**

Five most recent events, 24px chips, timeline spine, "From lead" pill, `formatDateTime · actor`, link out to the tab:

```tsx
'use client'

import { cn, formatDateTime } from '@/lib/utils'
import type { MatterActivity } from '@/types/database'
import { activityEventTitle, eventMetaFor } from '../activityEventMeta'

export function PanelActivity({
  activity,
  onOpenTab,
}: {
  activity: MatterActivity[]
  onOpenTab: () => void
}) {
  const recent = activity.slice(0, 5)
  if (recent.length === 0) {
    return <p className="px-1.5 text-[11.5px] text-muted-foreground">No activity yet.</p>
  }

  return (
    <div className="px-1.5">
      <div className="relative grid gap-3">
        <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-border" />
        {recent.map(event => {
          const meta = eventMetaFor(event.event_type)
          const EventIcon = meta.icon
          return (
            <article key={event.id} className="relative flex gap-2.5">
              <div
                role="img"
                aria-label={meta.label}
                className={cn(
                  'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full',
                  meta.color,
                )}
              >
                <EventIcon className="size-3" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium">{activityEventTitle(event)}</p>
                {event.metadata?.origin === 'lead' && (
                  <span className="inline-flex rounded-full border border-border px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                    From lead
                  </span>
                )}
                {event.detail && <p className="text-[11px] text-muted-foreground">{event.detail}</p>}
                <p className="mt-px text-[11px] text-muted-foreground">
                  {formatDateTime(event.created_at)}
                  {event.actor_name ? ` · ${event.actor_name}` : ''}
                </p>
              </div>
            </article>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onOpenTab}
        className="mt-2.5 text-[11px] font-semibold text-accent hover:underline"
      >
        Open activity tab
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Build `MatterFactsPanel.tsx`**

Props (exact contract the panel test and `MatterDetailClient` both use):

```tsx
interface MatterFactsPanelProps {
  matter: PipelineMatter
  matterId: string
  details: MatterDetailsRow | null
  designSheetPlanType: string | null
  estate: MatterEstateSnapshot
  activity: MatterActivity[]
  noteText: string
  onNoteTextChange: (value: string) => void
  onAddNote: () => void
  noteSaving: boolean
  noteCount: number
  latestNoteAt: string | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
  savingField: keyof MatterDetailsRow | null
  lastSavedAt: string | null
  error: string | null
  /** Jump the tab strip, e.g. to Activity or People. */
  onOpenTab: (tab: MatterTab) => void
}
```

Structure:

1. **Contacts fetch** — `useEffect` on `matterId`: `GET /api/admin/matters/${matterId}/contacts` with the bearer token from `useAccessToken()`; store `client` and the `spouse` contact (`contacts.find(c => c.relationship_type === 'spouse')`); `loadingContacts` gates the Contact/Spouse bodies with a two-line skeleton (`<div className="h-4 animate-pulse rounded bg-muted" />`).
2. **`saveClientField(field, value)`** — `PATCH` the same URL with `{ target: 'client', patch: { [field]: value } }`, then optimistically merge into local state and `toast.success('Saved')`; on failure `toast.error` and revert. **`saveSpouseField`** is the same with `{ target: 'contact', contactId: spouse.id, patch: {...} }`.
3. **Identity header** — avatar initials from the client name; `InlineText` for `full_name` (saves through `saveClientField`); sub-line `age · <marital select> · city, state` where age is `ageInYearsFromDob(client.date_of_birth)` and the select saves `marital_status`; three chip selects — Urgency (`urgency`: high/normal/low), Fee status (`fee_payment_status`: unpaid/deposit/paid_in_full, labels Unpaid/Deposit/Paid in full), Attorney decision (`ep_ma_estate_taxable`: `'tax-sensitive' → true`, `'not-tax-sensitive' → false`, `'not-reviewed' → null`). Chips use `bg-amber-bg text-amber` (urgency high), `bg-muted` (fee), `bg-accent/10 text-accent` (decision). Below: the restored hint (`restored ? 'Sections restored' : null`) left, "Collapse all" right.
4. **Contact** — `InlineText` Email, Phone; `AddressAutocomplete` inside an editable Address row saving `address_line1`/`city`/`state`/`zip` from `ParsedAddress`; `InlineDate` Date of birth rendered read-mode as `formatDobWithAge`; Minor children read-only from child contacts (`minor = ageInYearsFromDob(dob) < 18`), rendered `None · 2 adult` style, clicking opens the People tab via `onOpenTab('people')`.
5. **Spouse** — rendered only when `isMarried(matter.marital_status)` (copy the one-line helper from `MatterOverviewHero`); Name/Email/Phone through `saveSpouseField`; hint shows the spouse name.
6. **Matter details** — `InlineSelect` Practice area (`PRACTICE_AREA_OPTIONS`), Plan (`MATTER_PLAN_TYPE_OPTIONS`, with a `Link` to `/admin/drafting/${matterId}?step=design` in the section hint), `InlineText` Lead source (`referral_source`); the two-up read-only stat block using `formatAssetCurrency(estate.grossEstateEstimate)` and `formatAssetCurrency(estate.estimatedMaTax)` (tax cell `bg-amber-bg text-amber`); `InlineText` Flat fee saving `Number(...)` or null.
7. **Dates** — `InlineDate` Intake received (`intake_date`), Engagement signed (`engagement_signed_at`), Design meeting (`design_meeting_date`), Target signing (`scheduled_signing_date`, `emphasized`, saved through `normalizeTargetSigningDate`); values read through `toDateInputValue` / `targetSigningDateInput`; hint shows the target signing date.
8. **Notes** — `Textarea` bound to `noteText`/`onNoteTextChange`, saving on blur via `onAddNote` only when non-empty, plus an explicit "Add note" `Button`; hint `${noteCount} · latest ${formatDate(latestNoteAt)}`.
9. **Activity** — `<PanelActivity activity={activity} onOpenTab={() => onOpenTab('activity')} />`; hint is the newest event date.
10. **Save status** — reuse the `ReadFirstPanel` status line wording at the panel foot: `savingField ? 'Saving…' : error ?? (lastSavedAt && 'Saved ' + time)`, `role="alert"` when error.

Outer wrapper: `<div className="flex h-full w-full flex-col gap-2.5 overflow-y-auto bg-background p-3">`.

- [ ] **Step 5: Run the panel test until green**

Run: `npx vitest run tests/matter-facts-panel.test.tsx`
Expected: PASS — 10 tests. Fix the component, not the assertions, unless an assertion is provably wrong about the design.

- [ ] **Step 6: Commit**

```bash
git add "app/admin/matters/[id]/facts-panel/" tests/matter-facts-panel.test.tsx
git commit -m "Add the matter facts panel"
```

---

### Task 6: Mount it and retire the old rail

**Files:**
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx`
- Delete: `app/admin/matters/[id]/MatterOverviewFactsRail.tsx`

- [ ] **Step 1: Swap the rail contents**

Replace the `<MatterFactsRail … />` child of `ResponsiveDetailRail` with `<MatterFactsPanel … />`, passing the props from the Task 5 contract: `matter`, `matterId`, `details={matterDetails}`, `designSheetPlanType`, `estate={initialEstateSnapshot}`, `activity`, the note state from `useMatterNotes` (`noteText`, `setNoteText`, `handleAddNote`, `noteSaving`), `noteCount={linkedNotes.length}`, `latestNoteAt={linkedNotes[0]?.created_at ?? null}`, `onSaveField={handleSaveMatterDetailField}`, `savingField`, `lastSavedAt`, `error`, and `onOpenTab={tab => setActiveTab(tab)}`.

Widen the rail: `desktopClassName="w-[352px] border-r border-border bg-card"`.

- [ ] **Step 2: Delete what the panel replaced**

Remove the local `MatterFactsRail` and `RailDate` helpers and the `MatterOverviewFactsRail` import from `MatterDetailClient.tsx`. Then confirm nothing else imports the old file:

Run: `grep -rn "MatterOverviewFactsRail" app components tests lib`
Expected: no hits. Then `git rm "app/admin/matters/[id]/MatterOverviewFactsRail.tsx"`.

If `MatterReadinessDial` is no longer rendered anywhere after removing `MatterFactsRail`, keep it mounted in the panel above the Contact section rather than silently dropping a feature — the readiness dial is not part of this redesign but must not disappear.

- [ ] **Step 3: Lint and typecheck**

Run: `npx eslint "app/admin/matters/[id]/" && npx tsc --noEmit -p tsconfig.typecheck.json 2>&1 | grep -E "matters/\[id\]"`
Expected: clean; no output from the grep.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: the new tests pass; the only failure is the documented `lead-detail-interactions` baseline. Any other failure is a regression from this work — fix it.

- [ ] **Step 5: Build**

Run: `npm run build:next`
Expected: `✓ Compiled successfully`.

- [ ] **Step 6: Commit**

```bash
git add -A "app/admin/matters/[id]"
git commit -m "Mount the matter facts panel and retire the old facts rail"
```

---

### Task 7: Report

- [ ] **Step 1: Summarize honestly**

State: what shipped, the test counts, the deliberate deviations (rail widened rather than moved into the Overview grid; marital status lives only in the identity header), and that the admin UI is behind sign-in so verification was tests + build rather than a click-through. Do not claim visual parity with `5a` that was not actually observed.
