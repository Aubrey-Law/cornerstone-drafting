# Matter Activity Event Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace actor initials in the matter Activity timeline with the prior event-specific icons and colors while preserving the redesigned timeline behavior.

**Architecture:** Keep all behavior in the existing `MatterActivityTab` component. Reintroduce a typed event-metadata map that selects a Lucide icon, color classes, and accessible label for each mapped event; use the Info treatment as the fallback. Exercise the real rendered component with a focused jsdom test.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Lucide React, Vitest, Testing Library.

## Global Constraints

- Scope is limited to the timeline marker in `app/admin/matters/[id]/MatterActivityTab.tsx`.
- Preserve grouping by day, draft document links, lead-origin badges, detail text, timestamps, actor-name metadata, loading state, and empty state.
- Remove actor initials from timeline markers.
- Use event-specific icon and color treatments with an Info/muted fallback.
- No schema, API, query, drafting-workflow, or dependency changes.

---

### Task 1: Restore Event-Specific Timeline Markers

**Files:**
- Modify: `app/admin/matters/[id]/MatterActivityTab.tsx`
- Create: `tests/matter-activity-icons.test.tsx`

**Interfaces:**
- Consumes `ActivityEventType` and `MatterActivity` from `types/database.ts`.
- Produces a typed `EVENT_META` map whose entries contain `icon`, `color`, and
  `label`, and whose fallback is the `matter_created` Info treatment.
- Preserves the existing public component signature:
  `MatterActivityTab({ activity, loading }: { activity: MatterActivity[]; loading: boolean })`.

- [ ] **Step 1: Write the failing component test**

Create complete `MatterActivity` fixtures for `stage_changed`,
`intake_completed`, `draft_generated`, and unmapped `note_added` events. Render
the real component and assert the user-visible marker contract:

```tsx
// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MatterActivityTab } from '@/app/admin/matters/[id]/MatterActivityTab'
import type { ActivityEventType, MatterActivity } from '@/types/database'

function activity(
  id: string,
  eventType: ActivityEventType,
  actorName: string | null = 'Jane Doe',
): MatterActivity {
  return {
    id,
    matter_id: 'matter-1',
    event_type: eventType,
    actor_id: actorName ? 'actor-1' : null,
    actor_email: null,
    actor_name: actorName,
    title: `${eventType} event`,
    detail: null,
    metadata: null,
    created_at: '2026-07-25T14:00:00.000Z',
  }
}

afterEach(cleanup)

describe('matter activity event icons', () => {
  it('renders event icons instead of actor initials and keeps actor metadata', () => {
    render(
      <MatterActivityTab
        loading={false}
        activity={[
          activity('stage', 'stage_changed'),
          activity('complete', 'intake_completed'),
          activity('draft', 'draft_generated'),
          activity('fallback', 'note_added'),
        ]}
      />,
    )

    expect(screen.getByLabelText('Stage changed activity').querySelector('svg')?.classList.contains('lucide-activity')).toBe(true)
    expect(screen.getByLabelText('Intake completed activity').querySelector('svg')?.classList.contains('lucide-circle-check')).toBe(true)
    expect(screen.getByLabelText('Draft generated activity').querySelector('svg')?.classList.contains('lucide-file-text')).toBe(true)
    expect(screen.getByLabelText('Matter activity').querySelector('svg')?.classList.contains('lucide-info')).toBe(true)
    expect(screen.queryByText('JD')).toBeNull()
    expect(screen.getAllByText(/Jane Doe/)).toHaveLength(4)
  })
})
```

If the installed Lucide version renders a different stable class for
`CheckCircle2`, use the class produced by that real component and keep the
assertion tied to the icon type rather than its SVG path data.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- --run tests/matter-activity-icons.test.tsx
```

Expected: FAIL because no event-specific accessible markers or Lucide icons are
rendered and the `JD` initials are still present.

- [ ] **Step 3: Implement the minimal event metadata map**

Import the prior icon set and helpers:

```tsx
import { Activity, CheckCircle2, FileText, Info, Send, type LucideIcon } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import type { ActivityEventType, MatterActivity } from '@/types/database'
```

Define the typed metadata and fallback:

```tsx
interface EventMeta {
  icon: LucideIcon
  color: string
  label: string
}

const EVENT_META: Partial<Record<ActivityEventType, EventMeta>> = {
  stage_changed: { icon: Activity, color: 'text-accent bg-accent/10', label: 'Stage changed activity' },
  intake_sent: { icon: Send, color: 'text-accent bg-accent/10', label: 'Intake sent activity' },
  intake_completed: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Intake completed activity' },
  email_sent: { icon: Send, color: 'text-muted-foreground bg-muted', label: 'Email sent activity' },
  draft_generated: { icon: FileText, color: 'text-accent bg-accent/10', label: 'Draft generated activity' },
  draft_promoted_to_review: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Draft promoted to review activity' },
  matter_created: { icon: Info, color: 'text-muted-foreground bg-muted', label: 'Matter activity' },
}
```

For each event, resolve `const meta = EVENT_META[item.event_type] ??
EVENT_META.matter_created!`, assign `const EventIcon = meta.icon`, and replace
the initials marker with:

```tsx
<div
  className={cn(
    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
    meta.color,
  )}
  aria-label={meta.label}
>
  <EventIcon className="h-3.5 w-3.5" aria-hidden />
</div>
```

Remove `actorInitials`. Do not change the actor-name metadata line.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- --run tests/matter-activity-icons.test.tsx tests/lead-conversion-history.test.tsx tests/matter-activity-redesign.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Run changed-file verification**

Run:

```bash
npx eslint 'app/admin/matters/[id]/MatterActivityTab.tsx' tests/matter-activity-icons.test.tsx
git diff --check
```

Expected: both commands exit 0 with no diagnostics.

- [ ] **Step 6: Commit**

```bash
git add 'app/admin/matters/[id]/MatterActivityTab.tsx' tests/matter-activity-icons.test.tsx
git commit -m "fix: restore matter activity icons"
```
