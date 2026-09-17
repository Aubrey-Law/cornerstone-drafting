/**
 * Theme token source of truth.
 *
 * Architecture:
 * - `primitives` — fixed palette (theme-agnostic)
 * - `themes.*.semantic` — role-based colors (bg/text/border/feedback)
 * - `themes.*.legacy` — shadcn/Tailwind aliases mapped from semantic roles
 *
 * Add a new theme by defining `themes.<name>` and running `npm run theme:generate`.
 *
 * Current theme: zinc neutrals (shadcnuikit CRM), Outfit UI face, with
 * `brand.navy` / `brand.teal` carrying Aubrey Law's own two colours again.
 * They are an accent — headings, marks, the invoice, a selected surface — not
 * a repaint: buttons, body text and every surface stay neutral.
 *
 * Every pair listed in `contrastPairs`, `statusContrastPairs` and
 * `uiContrastPairs` below is enforced by tests/theme-contrast.test.ts. A value
 * changed here that breaks one fails the suite; that is the point.
 */

export type ThemeId = 'light' | 'dark'

export type SemanticTokens = {
  bg: {
    canvas: string
    subtle: string
    muted: string
    elevated: string
    inverse: string
  }
  text: {
    default: string
    secondary: string
    muted: string
    inverse: string
    onBrand: string
  }
  border: {
    default: string
    strong: string
    focus: string
    input: string
  }
  brand: {
    navy: string
    teal: string
    tealHover: string
    onNavy: string
    onTeal: string
  }
  feedback: {
    success: string
    successFg: string
    warning: string
    warningFg: string
    error: string
    errorFg: string
    info: string
    infoFg: string
  }
  interactive: {
    primary: string
    primaryFg: string
    secondary: string
    secondaryFg: string
    /** THE hover fill. Nothing else sets a surface on hover. */
    accent: string
    accentFg: string
    destructive: string
    destructiveFg: string
  }
  /**
   * THE "you are here" fill, and the only tinted surface in the app.
   *
   * Every selection signal used to be a neutral: `bg-accent` in the sidebar,
   * `bg-muted` in the design sheet index, `bg-primary/10` in the drafting
   * stepper, `bg-primary/5` on a selected day. Four of them are visible on one
   * screen and nothing ranked them, because with a near-black primary every
   * "this one" collapses to a grey. These carry the firm's teal so selection is
   * the one thing on screen wearing a colour.
   */
  selection: {
    bg: string
    fg: string
    /** The rule, underline or left marker beside the fill — never colour alone. */
    border: string
  }
  sidebar: {
    bg: string
    fg: string
    primary: string
    primaryFg: string
    accent: string
    accentFg: string
    border: string
    ring: string
  }
}

export type LegacyTokens = Record<string, string>

export type ThemeDefinition = {
  id: ThemeId
  colorScheme: 'light' | 'dark'
  semantic: SemanticTokens
  legacy: LegacyTokens
  /** Domain-specific tokens (stages, alerts, charts) — same keys per theme. */
  extended: Record<string, string>
}

/** Fixed brand + neutral primitives (zinc neutrals + the firm's own two colours). */
export const primitives = {
  // Zinc monochrome palette (shadcnuikit CRM). `brandNavy` is the neutral dark
  // *surface*, which is all `bg.inverse` ever wanted from it — it is not the
  // firm's navy and no longer stands in for one.
  brandNavy: '#18181b',       // dark inverse surface
  brandBlue: '#09090b',       // near-black primary (buttons, active states)
  brandBlueHover: '#27272b',  // primary hover
  // Aubrey Law's actual marks, read off public/aubrey-law-logo.svg. The zinc
  // retheme pointed `brand.navy`/`brand.teal` at neutrals and left the names in
  // place, so `text-brand-teal` in components/billing/InvoicePreview.tsx drew
  // near-black and the firm's colours survived only inside the client
  // interview's own `--gi-*` scope. These put the names back on the colours.
  firmNavy: '#1F2D5A',
  firmNavyDark: '#22304f',    // dark-theme navy *surface* (bg-brand-navy)
  firmTeal: '#1A6B72',        // 6.19:1 on white
  firmTealHover: '#145A60',
  firmTealDark: '#6FC7CE',    // dark-theme teal *foreground* (text-brand-teal)
  firmTealDarkHover: '#8FD8DE',
  brandBlueBright: '#09090b', // active indicator / accent
  white: '#ffffff',
  black: '#09090b',
} as const

const lightSemantic: SemanticTokens = {
  bg: {
    // `canvas` is the page; `elevated` is what sits on it. They were both
    // #ffffff, so every card in the app was the same colour as its background
    // and the only thing marking its edge was a 1.27:1 hairline. Tinting the
    // canvas is what makes a card a card — the border stays decorative.
    canvas: '#f4f4f5',
    subtle: '#ebebed',
    // Must stay distinguishable from `elevated`: `bg-muted` is overwhelmingly
    // drawn *on* a card, so it is one step below the card, not one below the
    // page.
    muted: '#e9e9ec',
    elevated: '#ffffff',
    inverse: primitives.brandNavy,
  },
  text: {
    default: '#27272b',
    secondary: '#3f3f46',
    // Was #737373: 4.74:1 on white but 4.35:1 on `muted` and 4.32:1 on the
    // sidebar, and the app draws it at 10px and 11px. Darkening `muted` made
    // that near-miss a real one, so the text moves with it — 5.05:1 on the new
    // `muted`, 6.12:1 on a card.
    muted: '#61616b',
    inverse: '#fafafb',
    onBrand: primitives.white,
  },
  border: {
    default: '#d4d4d8',
    strong: '#71717b',
    focus: '#27272b',
    // WCAG 1.4.11: an input is a UI component, so its boundary owes 3:1 — and
    // the design sheet and the client interview are almost entirely inputs.
    // #d4d4da gave 1.48:1. This is 3.42:1 on a card and 3.11:1 on the canvas,
    // measured both ways because inputs appear on both.
    input: '#8a8a94',
  },
  brand: {
    navy: primitives.firmNavy,
    teal: primitives.firmTeal,
    tealHover: primitives.firmTealHover,
    onNavy: '#fafafb',
    onTeal: primitives.white,
  },
  feedback: {
    success: 'oklch(0.48 0.12 155)',
    successFg: primitives.white,
    warning: 'oklch(0.42 0.10 70)',
    warningFg: '#ffffff',
    error: '#e7000b',
    errorFg: primitives.white,
    info: 'oklch(0.42 0.10 240)',
    infoFg: primitives.white,
  },
  interactive: {
    primary: primitives.brandBlue,
    primaryFg: primitives.white,
    secondary: '#d4d4da',
    secondaryFg: '#27272b',
    accent: '#e0e0e4',
    accentFg: '#27272b',
    destructive: '#e7000b',
    destructiveFg: primitives.white,
  },
  selection: {
    bg: '#e2efef',
    fg: '#14444a',   // 8.99:1 on the fill
    border: primitives.firmTeal,
  },
  sidebar: {
    // White, like the admin shell's own aside (which uses `bg-card`), so the
    // portal sidebar reads as a panel raised off the tinted canvas rather than
    // dissolving into it.
    bg: '#ffffff',
    fg: '#61616b',
    primary: primitives.brandBlue,
    primaryFg: primitives.white,
    accent: '#e0e0e4',
    accentFg: '#09090b',
    border: '#d4d4d8',
    ring: '#27272b',
  },
}

const darkSemantic: SemanticTokens = {
  bg: {
    // Same split as light, inverted: `elevated` lifts off `canvas` instead of
    // being the identical near-black. Near black the WCAG ratio compresses and
    // no two dark greys will ever reach 3:1, so a dark card is read from the
    // fill step *plus* a border that clears 3:1 against the card — which is
    // what `border.input` below is for.
    canvas: '#0a0a0c',
    subtle: '#101013',
    muted: '#212126',
    elevated: '#161619',
    inverse: '#fafafb',
  },
  text: {
    default: '#e4e4e8',
    secondary: '#d4d4da',
    muted: '#9f9fa7',
    inverse: '#09090b',
    onBrand: '#18181b',
  },
  border: {
    default: '#2e2e34',
    // Not decorative: `border-border-strong` draws the not-yet-reached markers
    // in components/leads/LeadProgress.tsx and the incomplete connector in the
    // matter stage strip, both of which carry progress state on their own. That
    // puts them under 1.4.11 too. 4.26:1 on a card.
    strong: '#7a7a85',
    focus: '#e4e4e8',
    // 3.46:1 against the new `elevated`, 3.76:1 against `canvas`. Was #3f3f46
    // at 1.91:1.
    input: '#6b6b76',
  },
  brand: {
    // Dark mode uses these in opposite roles: `bg-brand-navy` is a surface
    // (the assistant's code block, selected note chips), `text-brand-teal` is
    // a foreground (the invoice preview). So navy goes dark and teal goes
    // light — the same two hues, each at the lightness its role needs.
    navy: primitives.firmNavyDark,
    teal: primitives.firmTealDark,
    tealHover: primitives.firmTealDarkHover,
    onNavy: '#e4e4e8',
    onTeal: '#18181b',
  },
  feedback: {
    // Every dark feedback foreground was #ffffff, against fills that had been
    // brightened for dark mode and never revisited: white measured 2.89:1 on
    // error, 3.58:1 on info, 3.75:1 on warning. Darkening the fills is not the
    // fix — these tokens are used far more often as `bg-warning/10
    // text-warning`, where a darker fill would sink the *text* below AA on a
    // near-black card. So the label goes dark and the fill stays bright, which
    // is what a bright fill wants anyway. Success rises to 0.62 to match the
    // others' lightness, which is what lets it carry a dark label too.
    success: 'oklch(0.62 0.14 155)',
    successFg: '#0a0a0c',
    warning: 'oklch(0.62 0.14 70)',
    warningFg: '#0a0a0c',
    error: '#ff6467',
    errorFg: '#0a0a0c',
    info: 'oklch(0.62 0.14 240)',
    infoFg: '#0a0a0c',
  },
  interactive: {
    primary: '#fafafb',
    primaryFg: '#18181b',
    // Was #71717b, which put its own label at 3.81:1. A secondary button in
    // dark is a dark fill with a light label, not a mid grey with either.
    secondary: '#3f3f46',
    secondaryFg: '#e4e4e8',
    // One step above `muted`, not just above `elevated`: a hover has to read on
    // a sunken well as well as on a card, and those are only 3 points apart.
    accent: '#2b2b32',
    accentFg: '#e4e4e8',
    destructive: '#ff6467',
    destructiveFg: '#0a0a0c',
  },
  selection: {
    bg: '#16302f',
    fg: '#a8dfe2',   // 9.58:1 on the fill
    border: primitives.firmTealDark,
  },
  sidebar: {
    bg: '#101013',
    fg: '#e4e4e8',
    primary: '#fafafb',
    primaryFg: '#18181b',
    accent: '#24242a',
    accentFg: '#e4e4e8',
    border: '#2e2e34',
    ring: '#e4e4e8',
  },
}

function legacyFromSemantic(s: SemanticTokens): LegacyTokens {
  return {
    '--color-bg-canvas': s.bg.canvas,
    '--color-bg-subtle': s.bg.subtle,
    '--color-bg-muted': s.bg.muted,
    '--color-bg-elevated': s.bg.elevated,
    '--color-bg-inverse': s.bg.inverse,
    '--color-text-default': s.text.default,
    '--color-text-secondary': s.text.secondary,
    '--color-text-muted': s.text.muted,
    '--color-text-inverse': s.text.inverse,
    '--color-text-on-brand': s.text.onBrand,
    '--color-border-default': s.border.default,
    '--color-border-strong': s.border.strong,
    '--color-border-focus': s.border.focus,
    '--background': s.bg.canvas,
    '--foreground': s.text.default,
    '--card': s.bg.elevated,
    '--card-foreground': s.text.default,
    '--popover': s.bg.elevated,
    '--popover-foreground': s.text.default,
    '--primary': s.interactive.primary,
    '--primary-foreground': s.interactive.primaryFg,
    '--secondary': s.interactive.secondary,
    '--secondary-foreground': s.interactive.secondaryFg,
    '--muted': s.bg.muted,
    '--muted-foreground': s.text.muted,
    '--accent': s.interactive.accent,
    '--accent-foreground': s.interactive.accentFg,
    '--selected': s.selection.bg,
    '--selected-foreground': s.selection.fg,
    '--selected-border': s.selection.border,
    '--destructive': s.interactive.destructive,
    '--destructive-foreground': s.interactive.destructiveFg,
    '--border': s.border.default,
    '--input': s.border.input,
    '--ring': s.border.focus,
    '--success': s.feedback.success,
    '--success-foreground': s.feedback.successFg,
    '--warning': s.feedback.warning,
    '--warning-foreground': s.feedback.warningFg,
    '--info': s.feedback.info,
    '--info-foreground': s.feedback.infoFg,
    '--sidebar': s.sidebar.bg,
    '--sidebar-foreground': s.sidebar.fg,
    '--sidebar-primary': s.sidebar.primary,
    '--sidebar-primary-foreground': s.sidebar.primaryFg,
    '--sidebar-accent': s.sidebar.accent,
    '--sidebar-accent-foreground': s.sidebar.accentFg,
    '--sidebar-border': s.sidebar.border,
    '--sidebar-ring': s.sidebar.ring,
    '--brand-navy': s.brand.navy,
    '--brand-teal': s.brand.teal,
    '--brand-teal-hover': s.brand.tealHover,
    '--text-primary': s.text.default,
    '--text-secondary': s.text.secondary,
    '--text-tertiary': s.text.muted,
    '--page-bg': s.bg.canvas,
    '--page-bg-2': s.bg.subtle,
    '--surface': s.bg.elevated,
    '--surface-1': s.bg.elevated,
    '--surface-2': s.bg.subtle,
    '--border-strong': s.border.strong,
  }
}

const lightExtended: Record<string, string> = {
  // `--navy-*` are neutral hairlines (a calendar chip border), not brand: they
  // keep the zinc values on purpose.
  '--navy-06': 'rgba(9, 9, 11, 0.06)',
  '--navy-12': 'rgba(9, 9, 11, 0.12)',
  // `--teal-12` is the focus glow the client interview draws, and `--teal-bg`
  // is what a selected option goes. Both were near-black under the retheme,
  // which is why a focused field looked like a grey smudge.
  '--teal-12': 'rgba(26, 107, 114, 0.22)',
  '--teal-30': 'rgba(26, 107, 114, 0.38)',
  '--chart-1': '#09090b',
  '--chart-2': '#52525b',
  '--chart-3': '#27272b',
  '--chart-4': '#9f9fa7',
  '--chart-5': '#d4d4da',
  '--amber': '#92400e',
  '--amber-bg': '#fffbeb',
  '--amber-border': '#fcd34d',
  '--amber-light': '#fef9ee',
  '--amber-strong': '#b45309',
  '--amber-strong-bg': '#fef3c7',
  '--amber-strong-border': '#fde68a',
  '--amber-orange': '#d97706',
  '--red': '#991b1b',
  '--red-bg': '#fef2f2',
  '--red-strong': '#dc2626',
  '--red-strong-bg': '#fee2e2',
  '--red-strong-border': '#fca5a5',
  '--green': '#065f46',
  '--green-bg': '#ecfdf5',
  '--blue': '#1e40af',
  '--blue-bg': '#eff6ff',
  '--blue-strong': '#2563eb',
  '--blue-strong-dark': '#1d4ed8',
  '--blue-strong-bg': '#dbeafe',
  '--blue-strong-border': '#93c5fd',
  // Added 2026-09-09 for the Identity task pill, which needed a hue no other
  // source pill uses: every AA-passing pair already in the theme reads as one
  // that is taken — stage-done is Plan's green, stage-closed is Manual's grey,
  // amber-strong is Prompt's amber. A chip indistinguishable from another
  // source's carries no information, which is the whole point of the chip.
  // 8.19:1 against its own background in light, measured with
  // lib/theme/contrast.ts rather than picked by eye.
  '--violet': '#5b21b6',
  '--violet-bg': '#f5f3ff',
  // Feeds `--gi-faint`, the faintest text tier in the admin design sheet
  // (app/globals.css maps it there). Tinting the canvas took #71717b to 4.39:1
  // on it, so it tracks the muted-text token instead of carrying its own hex
  // and drifting away from it again.
  '--gray-mid': lightSemantic.text.muted,
  '--gray-soft': '#d4d4da',
  '--gray-bg': '#ebebed',
  '--teal-bg': '#e2efef',
  '--stage-early': '#2563eb',
  '--stage-early-bg': '#dbeafe',
  '--stage-early-text': '#1e40af',
  '--stage-active': '#7c3aed',
  '--stage-active-bg': '#ede9fe',
  '--stage-active-text': '#5b21b6',
  '--stage-work': '#c2410c',
  '--stage-work-bg': '#ffedd5',
  '--stage-work-text': '#9a3412',
  '--stage-done': '#15803d',
  '--stage-done-bg': '#dcfce7',
  '--stage-done-text': '#166534',
  '--stage-closed': '#4b5563',
  '--stage-closed-bg': '#eef0f3',
  '--stage-closed-text': '#374151',
  '--status-intake-bg': 'oklch(0.92 0.09 85)',
  '--status-intake-text': 'oklch(0.38 0.12 70)',
  '--status-drafting-bg': 'oklch(0.92 0.06 250)',
  '--status-drafting-text': 'oklch(0.38 0.12 250)',
  '--status-review-bg': 'oklch(0.92 0.07 300)',
  '--status-review-text': 'oklch(0.38 0.15 300)',
  '--status-signing-bg': 'oklch(0.92 0.07 145)',
  '--status-signing-text': 'oklch(0.38 0.12 145)',
  '--status-final-bg': 'oklch(0.92 0.01 260)',
  '--status-final-text': 'oklch(0.34 0.01 260)',
  '--status-overdue-bg': 'oklch(0.92 0.09 25)',
  '--status-overdue-text': 'oklch(0.38 0.15 25)',
}

const darkExtended: Record<string, string> = {
  '--navy-06': 'rgba(250, 250, 251, 0.06)',
  '--navy-12': 'rgba(250, 250, 251, 0.12)',
  '--teal-12': 'rgba(111, 199, 206, 0.22)',
  '--teal-30': 'rgba(111, 199, 206, 0.38)',
  '--chart-1': '#fafafb',
  '--chart-2': '#9f9fa7',
  '--chart-3': '#e4e4e8',
  '--chart-4': '#52525b',
  '--chart-5': '#3f3f46',
  '--amber': 'oklch(0.78 0.14 70)',
  '--amber-bg': 'oklch(0.22 0.05 75)',
  '--amber-border': 'oklch(0.50 0.12 75)',
  '--amber-light': 'oklch(0.20 0.04 75)',
  '--amber-strong': 'oklch(0.78 0.16 70)',
  '--amber-strong-bg': 'oklch(0.24 0.06 75)',
  '--amber-strong-border': 'oklch(0.42 0.10 75)',
  '--amber-orange': 'oklch(0.78 0.16 70)',
  '--red': 'oklch(0.70 0.16 25)',
  '--red-bg': 'oklch(0.21 0.05 25)',
  '--red-strong': 'oklch(0.68 0.18 25)',
  '--red-strong-bg': 'oklch(0.24 0.07 25)',
  '--red-strong-border': 'oklch(0.42 0.13 25)',
  '--green': 'oklch(0.68 0.14 155)',
  '--green-bg': 'oklch(0.22 0.05 155)',
  '--blue': 'oklch(0.68 0.10 262)',
  '--blue-bg': 'oklch(0.22 0.04 262)',
  '--blue-strong': 'oklch(0.68 0.12 262)',
  '--blue-strong-dark': 'oklch(0.62 0.12 262)',
  '--blue-strong-bg': 'oklch(0.25 0.05 262)',
  '--blue-strong-border': 'oklch(0.42 0.08 262)',
  // See the light record. 8.30:1 here, which sits alongside amber's 8.48 and
  // is measured, not assumed.
  '--violet': 'oklch(0.78 0.14 295)',
  '--violet-bg': 'oklch(0.22 0.05 295)',
  '--gray-mid': darkSemantic.text.muted,
  '--gray-soft': '#52525b',
  '--gray-bg': '#101013',
  '--teal-bg': '#16302f',
  '--stage-early': 'oklch(0.68 0.12 262)',
  '--stage-early-bg': 'oklch(0.22 0.04 262)',
  '--stage-early-text': 'oklch(0.78 0.10 262)',
  '--stage-active': 'oklch(0.68 0.12 295)',
  '--stage-active-bg': 'oklch(0.22 0.04 295)',
  '--stage-active-text': 'oklch(0.78 0.12 295)',
  '--stage-work': 'oklch(0.72 0.14 40)',
  '--stage-work-bg': 'oklch(0.22 0.05 40)',
  '--stage-work-text': 'oklch(0.78 0.14 40)',
  '--stage-done': 'oklch(0.68 0.14 155)',
  '--stage-done-bg': 'oklch(0.22 0.05 155)',
  '--stage-done-text': 'oklch(0.78 0.14 155)',
  '--stage-closed': 'oklch(0.68 0.008 262)',
  '--stage-closed-bg': 'oklch(0.22 0.03 262)',
  '--stage-closed-text': 'oklch(0.78 0.008 262)',
  '--status-intake-bg': 'oklch(0.24 0.06 85)',
  '--status-intake-text': 'oklch(0.78 0.14 75)',
  '--status-drafting-bg': 'oklch(0.24 0.05 250)',
  '--status-drafting-text': 'oklch(0.82 0.10 250)',
  '--status-review-bg': 'oklch(0.24 0.05 295)',
  '--status-review-text': 'oklch(0.82 0.12 300)',
  '--status-signing-bg': 'oklch(0.24 0.06 155)',
  '--status-signing-text': 'oklch(0.82 0.12 145)',
  '--status-final-bg': 'oklch(0.22 0.03 262)',
  '--status-final-text': 'oklch(0.78 0.008 262)',
  '--status-overdue-bg': 'oklch(0.22 0.06 25)',
  '--status-overdue-text': 'oklch(0.72 0.16 25)',
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  light: {
    id: 'light',
    colorScheme: 'light',
    semantic: lightSemantic,
    legacy: legacyFromSemantic(lightSemantic),
    extended: lightExtended,
  },
  dark: {
    id: 'dark',
    colorScheme: 'dark',
    semantic: darkSemantic,
    legacy: legacyFromSemantic(darkSemantic),
    extended: darkExtended,
  },
}

export type ThemePair = {
  name: string
  theme: ThemeId
  foreground: (t: ThemeDefinition) => string
  background: (t: ThemeDefinition) => string
}

const THEME_IDS: readonly ThemeId[] = ['light', 'dark']

/** Declares one pair against both themes, so neither can drift alone. */
function bothThemes(
  name: string,
  foreground: (t: ThemeDefinition) => string,
  background: (t: ThemeDefinition) => string,
): ThemePair[] {
  return THEME_IDS.map((theme) => ({ name, theme, foreground, background }))
}

/**
 * Foreground/background pairs that must meet WCAG AA (4.5:1).
 *
 * This list carried the comment "must meet WCAG AA" for its whole life with
 * nothing anywhere that checked it, and it only ever named nine pairs. That is
 * how the dark destructive, warning and info labels sat at 2.89:1, 3.58:1 and
 * 3.75:1 undisturbed. tests/theme-contrast.test.ts now drives every entry.
 */
export const contrastPairs: ThemePair[] = [
  ...bothThemes('canvas/default text', (t) => t.semantic.text.default, (t) => t.semantic.bg.canvas),
  ...bothThemes('elevated/default text', (t) => t.semantic.text.default, (t) => t.semantic.bg.elevated),
  ...bothThemes('muted surface/default text', (t) => t.semantic.text.default, (t) => t.semantic.bg.muted),
  ...bothThemes('elevated/secondary text', (t) => t.semantic.text.secondary, (t) => t.semantic.bg.elevated),
  // The three that the app draws at 10px and 11px, so they get no large-text
  // allowance and no rounding in their favour.
  ...bothThemes('canvas/muted text', (t) => t.semantic.text.muted, (t) => t.semantic.bg.canvas),
  ...bothThemes('elevated/muted text', (t) => t.semantic.text.muted, (t) => t.semantic.bg.elevated),
  ...bothThemes('muted surface/muted text', (t) => t.semantic.text.muted, (t) => t.semantic.bg.muted),
  ...bothThemes('subtle/muted text', (t) => t.semantic.text.muted, (t) => t.semantic.bg.subtle),
  ...bothThemes('inverse surface/inverse text', (t) => t.semantic.text.inverse, (t) => t.semantic.bg.inverse),
  // `--gray-mid` is the design sheet's faintest text tier, via `--gi-faint`.
  ...bothThemes('canvas/faint text', (t) => t.extended['--gray-mid'], (t) => t.semantic.bg.canvas),
  ...bothThemes('elevated/faint text', (t) => t.extended['--gray-mid'], (t) => t.semantic.bg.elevated),
  ...bothThemes('primary button', (t) => t.semantic.interactive.primaryFg, (t) => t.semantic.interactive.primary),
  ...bothThemes('secondary button', (t) => t.semantic.interactive.secondaryFg, (t) => t.semantic.interactive.secondary),
  ...bothThemes('destructive button', (t) => t.semantic.interactive.destructiveFg, (t) => t.semantic.interactive.destructive),
  ...bothThemes('accent surface', (t) => t.semantic.interactive.accentFg, (t) => t.semantic.interactive.accent),
  ...bothThemes('selected surface', (t) => t.semantic.selection.fg, (t) => t.semantic.selection.bg),
  ...bothThemes('success fill', (t) => t.semantic.feedback.successFg, (t) => t.semantic.feedback.success),
  ...bothThemes('warning fill', (t) => t.semantic.feedback.warningFg, (t) => t.semantic.feedback.warning),
  ...bothThemes('error fill', (t) => t.semantic.feedback.errorFg, (t) => t.semantic.feedback.error),
  ...bothThemes('info fill', (t) => t.semantic.feedback.infoFg, (t) => t.semantic.feedback.info),
  ...bothThemes('brand navy fill', (t) => t.semantic.brand.onNavy, (t) => t.semantic.brand.navy),
  ...bothThemes('sidebar nav', (t) => t.semantic.sidebar.fg, (t) => t.semantic.sidebar.bg),
  ...bothThemes('sidebar accent', (t) => t.semantic.sidebar.accentFg, (t) => t.semantic.sidebar.accent),
  ...bothThemes('sidebar primary', (t) => t.semantic.sidebar.primaryFg, (t) => t.semantic.sidebar.primary),
]

/**
 * Pairs that must meet WCAG 1.4.11 Non-text Contrast (3:1).
 *
 * Only boundaries that *identify a control* belong here. A card's hairline does
 * not: a card is identified by its fill step away from the canvas, which
 * `elevatedLiftsOffCanvas` in the test guards instead. An input's boundary is
 * the whole of what says "this is a field", and it is the one the app has most
 * of, so it is held to the letter.
 */
export const uiContrastPairs: ThemePair[] = [
  ...bothThemes('input border on a card', (t) => t.semantic.border.input, (t) => t.semantic.bg.elevated),
  ...bothThemes('input border on the canvas', (t) => t.semantic.border.input, (t) => t.semantic.bg.canvas),
  ...bothThemes('focus ring on a card', (t) => t.semantic.border.focus, (t) => t.semantic.bg.elevated),
  ...bothThemes('focus ring on the canvas', (t) => t.semantic.border.focus, (t) => t.semantic.bg.canvas),
  ...bothThemes('strong border on a card', (t) => t.semantic.border.strong, (t) => t.semantic.bg.elevated),
  ...bothThemes('selection marker on a card', (t) => t.semantic.selection.border, (t) => t.semantic.bg.elevated),
  ...bothThemes('selection marker on its own fill', (t) => t.semantic.selection.border, (t) => t.semantic.selection.bg),
]

/** Status badge pairs (bg + text) per theme. */
export const statusContrastPairs = (['intake', 'drafting', 'review', 'signing', 'final', 'overdue'] as const).flatMap(
  (key) =>
    (['light', 'dark'] as const).map((themeId) => ({
      name: `status-${key}`,
      theme: themeId,
      foregroundKey: `--status-${key}-text`,
      backgroundKey: `--status-${key}-bg`,
    })),
)

export function allThemeCssVars(theme: ThemeDefinition): Record<string, string> {
  return { ...theme.legacy, ...theme.extended }
}
