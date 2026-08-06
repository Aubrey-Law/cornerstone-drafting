# Vendored fonts

Self-hosted variable fonts loaded via `next/font/local` in `app/layout.tsx`, so
production builds do not depend on Google's network at build time.

| File | Family | Axis range | Subset |
|---|---|---|---|
| `outfit-latin-var.woff2` | Outfit | wght 100–900 | latin |
| `dm-sans-latin-var.woff2` | DM Sans | wght 100–1000 | latin |
| `lora-latin-var.woff2` | Lora | wght 400–700 | latin |
| `eb-garamond-latin-var.woff2` | EB Garamond | wght 400–800 | latin |

Source: Google Fonts (fonts.gstatic.com), latin-subset variable woff2 files
(Outfit v15, DM Sans v17, Lora v37, EB Garamond v33). All are licensed under
the SIL Open Font License 1.1, which permits bundling and self-hosting.

Only the normal (non-italic) style is vendored — the previous
`next/font/google` config also loaded normal-only, so this is parity, and
browsers synthesize italics where needed. Latin-ext glyphs fall back to the
system font stack.

To refresh: request `https://fonts.googleapis.com/css2?family=<Family>:wght@<range>&display=swap`
with a modern browser User-Agent, then download the `/* latin */` block's
woff2 URL and update the version note above.
