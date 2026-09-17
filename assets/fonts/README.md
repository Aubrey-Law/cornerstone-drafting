# Vendored fonts

Self-hosted variable fonts loaded via `next/font/local` in `app/layout.tsx`, so
production builds do not depend on Google's network at build time.

| File | Family | Axis range | Subset |
|---|---|---|---|
| `outfit-latin-var.woff2` | Outfit | wght 100–900 | latin |
| `dm-sans-latin-var.woff2` | DM Sans | wght 100–1000 | latin |
| `lora-latin-var.woff2` | Lora | wght 400–700 | latin |
| `eb-garamond-latin-var.woff2` | EB Garamond | wght 400–800 | latin |
| `NothingYouCouldDo-Regular.ttf` | Nothing You Could Do | static 400 | full |

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

## The signature face

`NothingYouCouldDo-Regular.ttf` is not a web font and is never served to a
browser. It is read from disk on the server by `lib/esign/signatureFont.ts` and
embedded into an executed engagement agreement, so that a signer who types their
name gets something that reads as a signature rather than as body text.

TrueType rather than woff2, deliberately: `@pdf-lib/fontkit` embeds `.ttf`/`.otf`
and cannot read woff2, which is why the four faces above cannot be reused for
this. It is subset on embed, so only the glyphs in the signed names reach the
document.

Copyright (c) 2010 Kimberly Geswein, SIL Open Font License 1.1 — full text in
`NothingYouCouldDo-OFL.txt` beside it. The OFL permits embedding in a document.

`next.config.mjs` lists this file under `outputFileTracingIncludes` for
`/api/sign/[token]`; without that the signing route can lose it in a serverless
build. Losing it is not fatal — the module falls back to the italic serif that
shipped before it — but the fallback is a silent downgrade, so the trace entry
and its test exist to keep it from happening quietly.
