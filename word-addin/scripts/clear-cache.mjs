import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Clear the Office add-in web cache.
 *
 * Word caches the pane's HTML and JS hard enough to survive a dev-server
 * restart, a manifest re-sideload, and quitting Word. A cached bundle is
 * indistinguishable from a bug that will not die: you change code, reload, and
 * watch the old behaviour again.
 *
 * The non-obvious part is *where*. Add-in web content lives in Office's own web
 * host container, not Word's — `com.Microsoft.OsfWebHost`, with a capital M,
 * which is easy to get wrong and produces a command that appears to work and
 * changes nothing. Word's own Caches directory is cleared too, since some
 * builds keep a copy there.
 */

const TARGETS = [
  // The one that actually holds add-in web content.
  'Library/Containers/com.Microsoft.OsfWebHost/Data',
  // Word's own cache; harmless when absent, and some builds do use it.
  'Library/Containers/com.microsoft.Word/Data/Library/Caches',
]

if (process.platform !== 'darwin') {
  console.error(`This clears the macOS Office cache; nothing to do on ${process.platform}.`)
  process.exit(0)
}

let cleared = 0
let missing = 0

for (const relative of TARGETS) {
  const directory = join(homedir(), relative)
  if (!existsSync(directory)) {
    console.log(`—  not present: ~/${relative}`)
    missing++
    continue
  }

  // Empty the directory rather than removing it: Office recreates the contents
  // but not always the container itself, and a missing container can stop the
  // pane loading at all.
  let entries = 0
  for (const entry of readdirSync(directory)) {
    rmSync(join(directory, entry), { recursive: true, force: true })
    entries++
  }
  console.log(`✓  cleared ${entries} item${entries === 1 ? '' : 's'} from ~/${relative}`)
  cleared++
}

if (cleared === 0 && missing === TARGETS.length) {
  console.log('\nNothing to clear. If the pane still runs old code, it is not this cache.')
} else {
  console.log(
    [
      '',
      'Word must be fully quit (Cmd+Q) for this to stick — if it was running,',
      'quit it and run this again.',
      '',
      'Then reopen Word. The pane prints a `build <time>` line while it starts:',
      'if that matches when you started the dev server, you are on current code.',
    ].join('\n'),
  )
}
