// `server-only` ships as a Next.js-internal package with no standalone entry,
// so vitest can't resolve it. Modules under test that guard themselves with it
// resolve here instead; the guard still applies to the real build.
export {}
