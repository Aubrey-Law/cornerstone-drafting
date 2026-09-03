/**
 * Command-line argument parsing for the review CLI.
 *
 * Lives here rather than in the script so it can be tested: the script runs
 * `main()` on import, so anything defined inside it is only reachable by
 * running the whole thing.
 */

export type ParsedArgs = Record<string, string | true>

export type ParseArgsResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: string }

/**
 * Parses `--flag value` pairs, rejoining a value the shell split on spaces.
 *
 * The firm names every document `Date_Client Name_Document Type.docx`, so the
 * path this script is pointed at essentially always contains spaces. Unquoted,
 * one arrives here as several arguments, and the obvious parser rejects the
 * second fragment with a message naming a word the caller never typed as an
 * argument — technically correct and useless.
 *
 * So everything up to the next `--flag` is one value. Quoting still works and
 * is still the right habit; this only stops the common case from failing on a
 * shell detail that has nothing to do with reviewing a document.
 *
 * The cost is that a genuine typo in a value is no longer caught here. That is
 * the right trade for a path: a mistyped one fails immediately and clearly at
 * the filesystem, which is a better error than anything this function could
 * invent.
 */
export function parseArgs(argv: string[]): ParseArgsResult {
  const args: ParsedArgs = {}
  let i = 0

  while (i < argv.length) {
    const match = argv[i].match(/^--([a-z-]+)$/)
    if (!match) {
      return {
        ok: false,
        error: `Unexpected argument: ${argv[i]}\nArguments must start with -- (for example --file or --layer-only).`,
      }
    }

    const parts: string[] = []
    i += 1
    while (i < argv.length && !argv[i].startsWith('--')) {
      parts.push(argv[i])
      i += 1
    }
    // No value before the next flag means the flag is a switch.
    args[match[1]] = parts.length === 0 ? true : parts.join(' ')
  }

  return { ok: true, args }
}
