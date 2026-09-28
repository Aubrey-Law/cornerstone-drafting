/**
 * Where the sign-in dialog is served from, as an absolute URL.
 *
 * `import.meta.env.BASE_URL` is Vite's `base`: `/` for the dev server, where
 * this project is the origin root and `manifest.xml` points at
 * `https://localhost:3100/taskpane.html`, and `/addin/` for a build, where the
 * Next app serves the pane out of `public/addin/`. It always carries a
 * trailing slash, in both cases.
 *
 * Both call sites used to hardcode `/dialog.html`, which was right for as long
 * as the pane lived at the origin root. Once it moved under a path it resolved
 * to `https://cornerstone.aubreylegal.com/dialog.html` — a 404 — so Office
 * opened an empty dialog and the OAuth round trip had nowhere to return to.
 * Deriving it from the same `base` that puts the file there is what keeps the
 * two from drifting apart again.
 */
export function dialogUrl(origin: string = globalThis.location.origin): string {
  return `${origin}${import.meta.env.BASE_URL}dialog.html`
}
