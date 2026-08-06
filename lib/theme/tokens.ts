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
 * Current theme: monochrome zinc (shadcnuikit CRM), Outfit UI face. The
 * `brand.navy` / `brand.teal` fields are legacy aliases now mapped to neutrals
 * (dark inverse surface / primary respectively).
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
    accent: string
    accentFg: string
    destructive: string
    destructiveFg: string
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

/** Fixed brand + neutral primitives (monochrome zinc palette). */
export const primitives = {
  // Zinc monochrome palette (shadcnuikit CRM). The legacy "navy"/"blue" names
  // are kept so existing consumers keep compiling; they now map to neutrals.
  brandNavy: '#18181b',       // dark inverse surface
  brandBlue: '#09090b',       // near-black primary (buttons, active states)
  brandBlueHover: '#27272b',  // primary hover
  brandBlueBright: '#09090b', // active indicator / accent
  white: '#ffffff',
  black: '#09090b',
} as const

const lightSemantic: SemanticTokens = {
  bg: {
    canvas: '#ffffff',
    subtle: '#f4f4f6',
    muted: '#f5f5f5',
    elevated: '#ffffff',
    inverse: primitives.brandNavy,
  },
  text: {
    default: '#27272b',
    secondary: '#3f3f46',
    muted: '#737373',
    inverse: '#fafafb',
    onBrand: primitives.white,
  },
  border: {
    default: '#e4e4e8',
    strong: '#9f9fa7',
    focus: '#27272b',
    input: '#d4d4da',
  },
  brand: {
    navy: primitives.brandNavy,
    teal: primitives.brandBlue,
    tealHover: primitives.brandBlueHover,
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
    accent: '#e4e4e8',
    accentFg: '#27272b',
    destructive: '#e7000b',
    destructiveFg: primitives.white,
  },
  sidebar: {
    bg: '#f4f4f6',
    fg: '#71717b',
    primary: primitives.brandBlue,
    primaryFg: primitives.white,
    accent: '#e4e4e8',
    accentFg: '#09090b',
    border: '#e4e4e8',
    ring: '#27272b',
  },
}

const darkSemantic: SemanticTokens = {
  bg: {
    canvas: '#09090b',
    subtle: '#18181b',
    muted: '#18181b',
    elevated: '#09090b',
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
    default: '#27272b',
    strong: '#3f3f46',
    focus: '#e4e4e8',
    input: '#3f3f46',
  },
  brand: {
    navy: '#27272b',
    teal: '#fafafb',
    tealHover: '#e4e4e8',
    onNavy: '#e4e4e8',
    onTeal: '#18181b',
  },
  feedback: {
    success: 'oklch(0.55 0.14 155)',
    successFg: primitives.white,
    warning: 'oklch(0.62 0.14 70)',
    warningFg: primitives.white,
    error: '#ff6467',
    errorFg: primitives.white,
    info: 'oklch(0.62 0.14 240)',
    infoFg: primitives.white,
  },
  interactive: {
    primary: '#fafafb',
    primaryFg: '#18181b',
    secondary: '#71717b',
    secondaryFg: '#e4e4e8',
    accent: '#18181b',
    accentFg: '#e4e4e8',
    destructive: '#ff6467',
    destructiveFg: primitives.white,
  },
  sidebar: {
    bg: '#18181b',
    fg: '#e4e4e8',
    primary: '#fafafb',
    primaryFg: '#18181b',
    accent: '#27272b',
    accentFg: '#e4e4e8',
    border: '#27272b',
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
  '--navy-06': 'rgba(9, 9, 11, 0.06)',
  '--navy-12': 'rgba(9, 9, 11, 0.12)',
  '--teal-12': 'rgba(9, 9, 11, 0.12)',
  '--teal-30': 'rgba(9, 9, 11, 0.30)',
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
  '--gray-mid': '#71717b',
  '--gray-soft': '#d4d4da',
  '--gray-bg': '#f4f4f6',
  '--teal-bg': '#f4f4f6',
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
  '--teal-12': 'rgba(250, 250, 251, 0.12)',
  '--teal-30': 'rgba(250, 250, 251, 0.30)',
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
  '--gray-mid': '#9f9fa7',
  '--gray-soft': '#52525b',
  '--gray-bg': '#18181b',
  '--teal-bg': '#27272b',
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

/** Foreground/background pairs that must meet WCAG AA (4.5:1). */
export const contrastPairs: Array<{
  name: string
  theme: ThemeId
  foreground: (t: ThemeDefinition) => string
  background: (t: ThemeDefinition) => string
}> = [
  {
    name: 'canvas/default text',
    theme: 'light',
    foreground: (t) => t.semantic.text.default,
    background: (t) => t.semantic.bg.canvas,
  },
  {
    name: 'elevated/default text',
    theme: 'light',
    foreground: (t) => t.semantic.text.default,
    background: (t) => t.semantic.bg.elevated,
  },
  {
    name: 'muted/muted text',
    theme: 'light',
    foreground: (t) => t.semantic.text.muted,
    background: (t) => t.semantic.bg.muted,
  },
  {
    name: 'primary button',
    theme: 'light',
    foreground: (t) => t.semantic.interactive.primaryFg,
    background: (t) => t.semantic.interactive.primary,
  },
  {
    name: 'secondary button',
    theme: 'light',
    foreground: (t) => t.semantic.interactive.secondaryFg,
    background: (t) => t.semantic.interactive.secondary,
  },
  {
    name: 'destructive button',
    theme: 'light',
    foreground: (t) => t.semantic.interactive.destructiveFg,
    background: (t) => t.semantic.interactive.destructive,
  },
  {
    name: 'sidebar nav',
    theme: 'light',
    foreground: (t) => t.semantic.sidebar.fg,
    background: (t) => t.semantic.sidebar.bg,
  },
  {
    name: 'sidebar accent',
    theme: 'light',
    foreground: (t) => t.semantic.sidebar.accentFg,
    background: (t) => t.semantic.sidebar.accent,
  },
  {
    name: 'sidebar primary',
    theme: 'light',
    foreground: (t) => t.semantic.sidebar.primaryFg,
    background: (t) => t.semantic.sidebar.primary,
  },
  {
    name: 'canvas/default text',
    theme: 'dark',
    foreground: (t) => t.semantic.text.default,
    background: (t) => t.semantic.bg.canvas,
  },
  {
    name: 'elevated/default text',
    theme: 'dark',
    foreground: (t) => t.semantic.text.default,
    background: (t) => t.semantic.bg.elevated,
  },
  {
    name: 'muted/muted text',
    theme: 'dark',
    foreground: (t) => t.semantic.text.muted,
    background: (t) => t.semantic.bg.muted,
  },
  {
    name: 'primary button',
    theme: 'dark',
    foreground: (t) => t.semantic.interactive.primaryFg,
    background: (t) => t.semantic.interactive.primary,
  },
  {
    name: 'secondary button',
    theme: 'dark',
    foreground: (t) => t.semantic.interactive.secondaryFg,
    background: (t) => t.semantic.interactive.secondary,
  },
  {
    name: 'destructive button',
    theme: 'dark',
    foreground: (t) => t.semantic.interactive.destructiveFg,
    background: (t) => t.semantic.interactive.destructive,
  },
  {
    name: 'sidebar nav',
    theme: 'dark',
    foreground: (t) => t.semantic.sidebar.fg,
    background: (t) => t.semantic.sidebar.bg,
  },
  {
    name: 'sidebar accent',
    theme: 'dark',
    foreground: (t) => t.semantic.sidebar.accentFg,
    background: (t) => t.semantic.sidebar.accent,
  },
  {
    name: 'sidebar primary',
    theme: 'dark',
    foreground: (t) => t.semantic.sidebar.primaryFg,
    background: (t) => t.semantic.sidebar.primary,
  },
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
