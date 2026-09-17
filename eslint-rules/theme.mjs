/**
 * Lint rules that keep the theme from drifting back.
 *
 * Each one exists because the drift already happened once and nothing noticed:
 * 18 distinct font sizes with 11 of them written as raw pixels, eight opacities
 * of one surface token doing the work of three named roles, and 225 palette
 * classes bypassing the tokens entirely. Values are cheap to fix; what was
 * missing is anything that says "don't do that again".
 *
 * These read Tailwind classes out of string and template literals. That misses
 * a class assembled at runtime, which is the right trade: no false positives,
 * and the patterns below are written literally everywhere they appear today.
 */

/** Builds a rule that reports any string literal matching `pattern`. */
function classPatternRule({ description, pattern, messageId, message }) {
  return {
    meta: {
      type: 'problem',
      docs: { description },
      schema: [],
      messages: { [messageId]: message },
    },
    create(context) {
      // Every match, not just the first. One className holds many classes, and
      // reporting only the first hid `bg-amber-50` behind `border-amber-300`
      // on the same line — so a fix guided by the output left a violation
      // behind and the count understated the work.
      const all = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')

      function check(node, text) {
        if (typeof text !== 'string') return
        for (const found of text.matchAll(all)) {
          context.report({ node, messageId, data: { match: found[0] } })
        }
      }
      return {
        Literal(node) {
          check(node, node.value)
        },
        TemplateElement(node) {
          check(node, node.value.raw)
        },
      }
    },
  }
}

export const rules = {
  'no-arbitrary-font-size': classPatternRule({
    description: 'Use a named type step instead of an arbitrary pixel font size',
    pattern: /text-\[[0-9.]+px\]/,
    messageId: 'arbitrary',
    message:
      '"{{match}}" sets a one-off font size. Use a named step: text-micro (11px, the floor), text-xs (12), text-compact (13), text-sm (14). Client surfaces use the client-* scale in app/globals.css.',
  }),

  'no-surface-opacity': classPatternRule({
    description: 'Use the named surface roles instead of an opacity of one token',
    pattern: /\bbg-(?:muted|accent)\/\d+/,
    messageId: 'opacity',
    message:
      '"{{match}}" invents a surface between the named ones. There are three: bg-card (raised), bg-muted (sunken) and bg-accent (hover) — plus bg-selected for "you are here".',
  }),

  'no-raw-palette': classPatternRule({
    description: 'Use a semantic token instead of a raw Tailwind palette colour',
    pattern:
      /\b(?:bg|text|border|ring|from|via|to)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    messageId: 'palette',
    message:
      '"{{match}}" bypasses the theme and will not follow light/dark. Use a semantic token (bg-muted, text-muted-foreground, border-border, text-destructive, …). See packages/ui/src/theme/tokens.ts.',
  }),
}

export default { rules }
