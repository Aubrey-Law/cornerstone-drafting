// Shared DOCX marker regexes — kept free of node:fs so client-safe scanners can import them.

/** Leftover `{{ }}`, `{% %}`, or `[ALL-CAPS]` template syntax in rendered output. */
export const UNRESOLVED_RE = /({{.*?}}|{%.*?%}|\[[A-Z][A-Z0-9 _/-]*\])/g
