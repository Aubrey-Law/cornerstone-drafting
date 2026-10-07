/**
 * Stand-in for `next/font/local` under vitest.
 *
 * The real loader is a build-time transform: Next's compiler rewrites each call
 * and the module's default export is not callable on its own, so importing a
 * module that creates a font (lib/clientFonts.ts, reached through AuthShell,
 * GuidedInterview and others) would throw "default is not a function". This
 * returns the shape the real one does — a class and a CSS-variable class — so
 * components render, and keeps the variable name in the class so a test can
 * tell which font an element carries.
 */
export default function localFont(options: { variable?: string }) {
  const variable = options.variable ? `__font${options.variable}` : ''
  return {
    className: variable,
    variable,
    style: { fontFamily: 'sans-serif' },
  }
}
