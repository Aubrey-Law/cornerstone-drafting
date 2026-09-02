# @aubrey-law/estate-fields

Shared field registry for **Aubrey Law** client intake and design sheet UIs.

This repository (`cornerstone-drafting`) owns the package; the portal
(`aubrey-law-app`) consumes it. Both read the same dropdown labels,
normalization and sync rules so the vocabulary stays in one place.
See [SYNC.md](./SYNC.md) for how ownership works and how to consume it
from another application.

## Layout

| Path | Purpose |
|------|---------|
| `src/core/` | Registry, options, normalize, sync, assets, goals, fiduciaries, review formatters |
| `src/portal/` | Lead forms + intake validation (portal-only) |
| `src/react/` | `DesignField`, `IntakeField` with injected UI components |

## Install

Inside this repository it is a workspace member — nothing to install, and an
edit is live immediately.

From another application, depend on a published version rather than a relative
path across repositories:

```json
"@aubrey-law/estate-fields": "^0.1.0"
```

A `file:../aubrey-law-app/packages/estate-fields` style path is retired: it
requires both repositories to sit side by side on one disk, which holds on a
developer laptop and fails in CI and on Vercel. See [SYNC.md](./SYNC.md).

Either way, add to the consuming app's `next.config.mjs`:

```js
transpilePackages: ['@aubrey-law/estate-fields'],
```

## Usage

### Core (both apps)

```ts
import { getSharedField, MARITAL_STATUS_OPTIONS, syncFieldToDesign } from '@aubrey-law/estate-fields'
// or core-only:
import { normalizeMaritalStatus } from '@aubrey-law/estate-fields/core'
```

### Portal-only

```ts
import { validateIntakeField, LEAD_SOURCE_OPTIONS } from '@aubrey-law/estate-fields/portal'
```

### React — design sheet

Wrap design sheet sections with injected prefilled controls:

```tsx
import { DesignFieldComponentsProvider, DesignField } from '@aubrey-law/estate-fields/react'
import { PrefilledInput, PrefilledSelect, FieldLabel } from './sections/shared'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { designFieldTargetId } from '@/lib/designSheetReadiness'

<DesignFieldComponentsProvider value={{ PrefilledInput, PrefilledSelect, FieldLabel, Textarea, cn, designFieldTargetId }}>
  <DesignField fieldId="marital_status" sheet={sheet} onChange={onChange} originalValue={original('marital_status')} />
</DesignFieldComponentsProvider>
```

### React — intake wizard

```tsx
import { IntakeField } from '@aubrey-law/estate-fields/react'

<IntakeField fieldId="marital_status" value={value} onChange={setValue} variant="pills" />
```

## What stays in each app

- **Portal:** `citizenshipFromHousehold`, full intake sync processor, Supabase types
- **Cornerstone:** design section layout, document sections, draft payload assembly
- **Both:** thin re-exports under `lib/sharedFields/` (optional, for stable `@/` imports)

See [SYNC.md](./SYNC.md) for keeping repos aligned.
