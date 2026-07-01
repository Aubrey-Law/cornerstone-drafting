/**
 * Theme token source of truth.
 *
 * Architecture:
 * - `primitives` — fixed palette (theme-agnostic)
 * - `themes.*.semantic` — role-based colors (bg/text/border/feedback)
 * - `themes.*.legacy` — shadcn/Tailwind aliases mapped from semantic roles
 *
 * Add a new theme by defining `themes.<name>` and running `npm run theme:generate`.
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

/** Fixed brand + neutral primitives (OKLCH where possible). */
export const primitives = {
  // Counsel palette
  brandNavy: '#141929',       // charcoal-navy sidebar
  brandBlue: '#1E4A8C',       // sapphire primary (buttons, active states)
  brandBlueHover: '#163a70',  // sapphire hover
  brandBlueBright: '#2563EB', // active indicator / accent
  white: 'oklch(0.99 0.005 85)',
  black: 'oklch(0.12 0.02 262)',
} as const

const lightSemantic: SemanticTokens = {
  bg: {
    canvas: '#F4F6F9',         // cool slate canvas
    subtle: '#E8ECF2',
    muted: '#EEF1F6',
    elevated: '#ffffff',
    inverse: primitives.brandNavy,
  },
  text: {
    default: '#111827',
    secondary: '#374151',
    muted: '#5F6673',
    inverse: primitives.white,
    onBrand: primitives.white,
  },
  border: {
    default: '#E2E8F0',
    strong: '#CBD5E1',
    focus: primitives.brandBlue,
  },
  brand: {
    navy: primitives.brandNavy,
    teal: primitives.brandBlue,
    tealHover: primitives.brandBlueHover,
    onNavy: '#E2E8F8',
    onTeal: primitives.white,
  },
  feedback: {
    success: 'oklch(0.48 0.12 155)',
    successFg: primitives.white,
    warning: 'oklch(0.42 0.10 70)',
    warningFg: 'oklch(0.99 0.005 85)',
    error: 'oklch(0.48 0.18 25)',
    errorFg: primitives.white,
    info: 'oklch(0.42 0.10 240)',
    infoFg: primitives.white,
  },
  interactive: {
    primary: primitives.brandBlue,
    primaryFg: primitives.white,
    secondary: '#F1F5F9',
    secondaryFg: '#334155',
    accent: primitives.brandBlue,
    accentFg: primitives.white,
    destructive: 'oklch(0.48 0.18 25)',
    destructiveFg: primitives.white,
  },
  sidebar: {
    bg: primitives.brandNavy,
    fg: '#E2E8F8',
    primary: primitives.brandBlueBright,
    primaryFg: primitives.white,
    accent: 'rgba(30, 74, 140, 0.35)',
    accentFg: '#E2E8F8',
    border: 'rgba(255,255,255,0.07)',
    ring: primitives.brandBlueBright,
  },
}

const darkSemantic: SemanticTokens = {
  bg: {
    canvas: 'oklch(0.14 0.03 240)',
    subtle: 'oklch(0.18 0.03 240)',
    muted: 'oklch(0.22 0.035 240)',
    elevated: 'oklch(0.19 0.035 240)',
    inverse: primitives.white,
  },
  text: {
    default: 'oklch(0.94 0.008 220)',
    secondary: 'oklch(0.78 0.010 220)',
    muted: 'oklch(0.78 0.012 220)',
    inverse: 'oklch(0.14 0.03 240)',
    onBrand: primitives.white,
  },
  border: {
    default: 'oklch(0.30 0.038 240)',
    strong: 'oklch(0.38 0.04 240)',
    focus: 'oklch(0.65 0.14 240)',
  },
  brand: {
    navy: 'oklch(0.16 0.03 240)',
    teal: 'oklch(0.62 0.14 240)',
    tealHover: 'oklch(0.55 0.14 240)',
    onNavy: 'oklch(0.90 0.010 220)',
    onTeal: primitives.white,
  },
  feedback: {
    success: 'oklch(0.55 0.14 155)',
    successFg: primitives.white,
    warning: 'oklch(0.62 0.14 70)',
    warningFg: primitives.white,
    error: 'oklch(0.55 0.18 25)',
    errorFg: primitives.white,
    info: 'oklch(0.62 0.14 240)',
    infoFg: primitives.white,
  },
  interactive: {
    primary: 'oklch(0.58 0.16 240)',
    primaryFg: primitives.white,
    secondary: 'oklch(0.23 0.035 240)',
    secondaryFg: 'oklch(0.94 0.008 220)',
    accent: 'oklch(0.58 0.16 240)',
    accentFg: primitives.white,
    destructive: 'oklch(0.55 0.18 25)',
    destructiveFg: primitives.white,
  },
  sidebar: {
    bg: 'oklch(0.11 0.025 240)',
    fg: 'oklch(0.90 0.010 220)',
    primary: 'oklch(0.62 0.14 240)',
    primaryFg: primitives.white,
    accent: 'oklch(0.22 0.035 240)',
    accentFg: 'oklch(0.88 0.012 220)',
    border: 'oklch(0.28 0.036 240)',
    ring: 'oklch(0.62 0.14 240)',
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
    '--input': s.border.default,
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
  '--navy-06': 'rgba(20, 25, 41, 0.06)',
  '--navy-12': 'rgba(20, 25, 41, 0.12)',
  '--teal-12': 'rgba(30, 74, 140, 0.12)',
  '--teal-30': 'rgba(30, 74, 140, 0.30)',
  '--chart-1': 'oklch(0.646 0.222 41.116)',
  '--chart-2': 'oklch(0.6 0.118 184.704)',
  '--chart-3': 'oklch(0.398 0.07 227.392)',
  '--chart-4': 'oklch(0.828 0.189 84.429)',
  '--chart-5': 'oklch(0.769 0.188 70.08)',
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
  '--gray-mid': '#6b7280',
  '--gray-soft': '#d1d5db',
  '--gray-bg': '#f0f0f0',
  '--teal-bg': '#f0fdf9',
  '--stage-early': '#2563eb',
  '--stage-early-bg': '#eff6ff',
  '--stage-early-text': '#1e40af',
  '--stage-active': '#7c3aed',
  '--stage-active-bg': '#f5f3ff',
  '--stage-active-text': '#5b21b6',
  '--stage-work': '#c2410c',
  '--stage-work-bg': '#fff7ed',
  '--stage-work-text': '#9a3412',
  '--stage-done': '#15803d',
  '--stage-done-bg': '#f0fdf4',
  '--stage-done-text': '#166534',
  '--stage-closed': '#4b5563',
  '--stage-closed-bg': '#f9fafb',
  '--stage-closed-text': '#374151',
  '--status-intake-bg': 'oklch(0.95 0.08 85)',
  '--status-intake-text': 'oklch(0.42 0.12 70)',
  '--status-drafting-bg': 'oklch(0.95 0.05 250)',
  '--status-drafting-text': 'oklch(0.42 0.12 250)',
  '--status-review-bg': 'oklch(0.95 0.06 300)',
  '--status-review-text': 'oklch(0.42 0.15 300)',
  '--status-signing-bg': 'oklch(0.95 0.06 145)',
  '--status-signing-text': 'oklch(0.42 0.12 145)',
  '--status-final-bg': 'oklch(0.95 0.005 260)',
  '--status-final-text': 'oklch(0.38 0.01 260)',
  '--status-overdue-bg': 'oklch(0.95 0.08 25)',
  '--status-overdue-text': 'oklch(0.42 0.15 25)',
}

const darkExtended: Record<string, string> = {
  '--navy-06': 'oklch(0.22 0.03 262 / 0.5)',
  '--navy-12': 'oklch(0.25 0.03 262 / 0.6)',
  '--teal-12': 'oklch(0.25 0.04 195 / 0.5)',
  '--teal-30': 'oklch(0.35 0.06 195 / 0.6)',
  '--chart-1': 'oklch(0.62 0.18 41)',
  '--chart-2': 'oklch(0.62 0.12 185)',
  '--chart-3': 'oklch(0.55 0.08 227)',
  '--chart-4': 'oklch(0.72 0.16 84)',
  '--chart-5': 'oklch(0.70 0.16 70)',
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
  '--gray-mid': 'oklch(0.68 0.008 262)',
  '--gray-soft': 'oklch(0.48 0.008 262)',
  '--gray-bg': 'oklch(0.22 0.03 262)',
  '--teal-bg': 'oklch(0.22 0.04 195)',
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
