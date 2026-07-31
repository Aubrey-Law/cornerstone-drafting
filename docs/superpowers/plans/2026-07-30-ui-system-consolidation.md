# UI System Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the highest-risk bespoke UI patterns onto the repository's existing shadcn/Radix primitives while fixing mobile detail layouts, overlay accessibility, theme drift, and page-shell alignment.

**Architecture:** Keep `components/ui/*` as the low-level shadcn layer and add small application-level layout primitives only where multiple routes share a contract. Preserve specialized intake and drafting presentation, but replace custom interaction mechanics and hard-coded theme colors with accessible primitives and semantic tokens.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Radix UI, Vitest, Testing Library.

## Global Constraints

- Do not port or merge drafting code from `aubrey-law-app`.
- Preserve the drafting stepper and workflow behavior.
- Preserve portal message chronology, day separators, and compact timestamps.
- Preserve the admin-only `.admin-root` typography scope.
- Use existing shadcn/Radix primitives rather than adding another component library.
- Keep client intake light-themed; use one shared dark authentication shell for login, public intake registration, and password reset.
- Do not change data persistence, authorization, routing, or legal-document behavior.

---

### Task 1: Responsive admin detail rails and actions

**Files:**
- Create: `components/layout/ResponsiveDetailRail.tsx`
- Modify: `app/admin/leads/[id]/LeadDetailClient.tsx`
- Modify: `app/admin/matters/[id]/MatterDetailClient.tsx`
- Modify: `components/leads/LeadTopActions.tsx`
- Modify: `app/admin/matters/[id]/MatterDetailHeader.tsx`
- Test: `tests/responsive-detail-layout.test.tsx`

**Interfaces:**
- Produces: `ResponsiveDetailRail({ open, onOpenChange, label, children, desktopClassName, mobileClassName })`.
- Consumes: existing `Sheet`, `SheetContent`, and the current rail contents without changing their persistence behavior.

- [ ] **Step 1: Write the failing responsive rail tests**

Render `ResponsiveDetailRail` and assert that:

```tsx
expect(screen.getByRole('complementary', { name: 'Lead details' })).toHaveClass('hidden', 'md:flex')
expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
rerender(<ResponsiveDetailRail open onOpenChange={onOpenChange} label="Lead details">Details</ResponsiveDetailRail>)
expect(screen.getByRole('dialog')).toBeInTheDocument()
```

Render `LeadTopActions` and `MatterDetailHeader` in a narrow container and assert that secondary actions are available from named overflow menus rather than requiring the full desktop action row.

- [ ] **Step 2: Run the tests and verify the missing component/behavior fails**

Run: `npm test -- tests/responsive-detail-layout.test.tsx`

Expected: failure because `ResponsiveDetailRail` does not exist and mobile action grouping is absent.

- [ ] **Step 3: Implement the shared responsive rail**

Render the existing rail as a desktop-only `aside` and reuse the same content in a controlled mobile `Sheet`. Keep the accessible label on both surfaces and notify the page through `onOpenChange`.

- [ ] **Step 4: Integrate both detail pages**

Keep one `open` state per page, but use it as the mobile sheet state and desktop visibility state. Ensure mobile content always retains the full viewport width and the rail toggle has a clear accessible name.

- [ ] **Step 5: Consolidate secondary mobile actions**

Keep the primary action visible. Hide the desktop action row below `md` and expose call, email, text, intake, drafting, and rail actions through the existing overflow menu or a named mobile menu.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/responsive-detail-layout.test.tsx tests/matter-overview-frame.test.ts tests/lead-detail-interactions.test.tsx`

Expected: all focused tests pass.

### Task 2: Accessible overlays

**Files:**
- Modify: `app/(portal)/PortalShell.tsx`
- Modify: `components/intake/IntakeWizard.tsx`
- Modify: `components/intake/GuidedInterview.tsx`
- Test: `tests/accessibility-overlays.test.tsx`

**Interfaces:**
- Consumes: `Sheet` for mobile navigation and `Dialog` for intake modals.
- Produces: named dialogs with Escape handling, focus containment, and focus restoration supplied by Radix.

- [ ] **Step 1: Write failing behavior tests**

For each overlay, render the real component or the narrow exported overlay component and assert:

```tsx
expect(screen.getByRole('dialog', { name: /review your estate plan organizer/i })).toBeInTheDocument()
await user.keyboard('{Escape}')
expect(onClose).toHaveBeenCalled()
```

For portal navigation, open the menu and assert a named dialog contains the navigation links and closes on Escape.

- [ ] **Step 2: Run the tests and verify they fail for missing dialog behavior**

Run: `npm test -- tests/accessibility-overlays.test.tsx`

Expected: the hand-built overlays lack dialog semantics or do not close on Escape.

- [ ] **Step 3: Replace the portal overlay with `Sheet`**

Retain the existing sidebar content and appearance. Use `SheetContent side="left"` and close the sheet after navigation.

- [ ] **Step 4: Replace intake custom modals with `Dialog`**

Preserve visual layout, copy, callbacks, and form state. Use `DialogTitle`, `DialogContent`, and the supplied close controls instead of fixed overlay wrappers.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/accessibility-overlays.test.tsx tests/portal-message-thread.test.tsx`

Expected: all focused tests pass.

### Task 3: Shared authentication and page shells

**Files:**
- Create: `components/layout/AuthShell.tsx`
- Create: `components/layout/AdminPageShell.tsx`
- Modify: `app/auth/login/page.tsx`
- Modify: `app/auth/reset-password/page.tsx`
- Modify: `app/intake/start/page.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/works/WorksClient.tsx`
- Modify: `app/admin/assistant/AssistantShell.tsx`
- Modify: `app/admin/pipeline/aging/MatterAgingClient.tsx`
- Test: `tests/ui-shells.test.tsx`

**Interfaces:**
- Produces: `AuthShell({ children, logoWidth?, logoHeight? })`.
- Produces: `AdminPageShell({ children, width?, spacing?, edgeToEdge? })`.

- [ ] **Step 1: Write failing shell tests**

Assert that all authentication pages use a shared dark shell and that `AdminPageShell` owns standard gutters without adding padding on top of the admin layout:

```tsx
render(<AuthShell><div>Content</div></AuthShell>)
expect(screen.getByRole('main')).toHaveClass('dark', 'bg-background')

render(<AdminPageShell><div>Content</div></AdminPageShell>)
expect(screen.getByTestId('admin-page-shell')).not.toHaveClass('p-4')
```

- [ ] **Step 2: Run tests and verify missing components fail**

Run: `npm test -- tests/ui-shells.test.tsx`

Expected: failure because the shared shells do not exist.

- [ ] **Step 3: Implement and adopt `AuthShell`**

Move the shared logo, centered viewport, dark theme boundary, width, and spacing into the shell. Make password reset follow the same visual contract without changing authentication logic.

- [ ] **Step 4: Implement and adopt `AdminPageShell`**

Remove duplicated page padding from Today, Works, and Assistant. Move Pipeline Aging to `PageHeader` while preserving its filters and data.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/ui-shells.test.tsx tests/admin-rail-chrome.test.tsx`

Expected: all focused tests pass.

### Task 4: Semantic theme cleanup and portal message column

**Files:**
- Modify: `app/admin/drafting/[matterId]/design/sections/AssetsSection.tsx`
- Modify: `app/admin/works/components/WorkflowDetail.tsx`
- Modify: `components/documents/DocumentStatusBadges.tsx`
- Modify: `app/(portal)/messages/MessageThread.tsx`
- Test: `tests/theme-and-portal-consistency.test.tsx`

**Interfaces:**
- Consumes: existing semantic colors from `styles/theme/generated.css`.
- Preserves: message grouping, timestamps, send behavior, and sticky composer.

- [ ] **Step 1: Write failing component tests**

Render the affected components and assert semantic classes are present on totals/statuses. Render `MessageThread` and assert the header, thread, and composer use the same centered `max-w-3xl` column.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- tests/theme-and-portal-consistency.test.tsx`

Expected: failure because hard-coded colors and unconstrained message layout remain.

- [ ] **Step 3: Replace hard-coded colors**

Use semantic foreground, warning, info, and success tokens. Preserve domain meaning and existing status text.

- [ ] **Step 4: Align the portal message column**

Use a shared `mx-auto w-full max-w-3xl` inner column for the header, messages, and composer while retaining the full-height outer flex container and sticky composer.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/theme-and-portal-consistency.test.tsx tests/portal-message-thread.test.tsx`

Expected: all focused tests pass.

### Task 5: Repository verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the focused UI suite**

Run:

```bash
npm test -- tests/responsive-detail-layout.test.tsx tests/accessibility-overlays.test.tsx tests/ui-shells.test.tsx tests/theme-and-portal-consistency.test.tsx tests/portal-message-thread.test.tsx tests/matter-overview-frame.test.ts tests/lead-detail-interactions.test.tsx tests/admin-rail-chrome.test.tsx
```

- [ ] **Step 2: Run lint and typecheck**

Run: `npm run lint`

Run: `npm run typecheck`

- [ ] **Step 3: Run the production build**

Run: `npm run build:next`

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check`

Run: `git status -sb`

Confirm that only the planned UI, test, and plan files changed.
