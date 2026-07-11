// Shared DOCX marker regexes — kept free of node:fs so client-safe scanners can import them.

/** Leftover `{{ }}`, `{% %}`, or `[ALL-CAPS]` template syntax in rendered output. */
export const UNRESOLVED_RE = /({{.*?}}|{%.*?%}|\[[A-Z][A-Z0-9 _/-]*\])/g

/**
 * Bracketed all-caps tokens that are real document text, not template markers —
 * e.g. the health care proxy reads "Do Not Resuscitate [DNR] orders and
 * Cardiopulmonary Resuscitation [CPR] directives". Matches of UNRESOLVED_RE
 * equal to one of these must not be reported as unresolved.
 */
export const LITERAL_BRACKET_TOKENS = new Set(['[DNR]', '[CPR]'])
