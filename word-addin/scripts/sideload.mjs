import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readManifestId, sideloadFilename, wordSideloadDirectory } from './manifestId.mjs'

/**
 * Register the add-in with Word by copying its manifest into Word's sideload
 * folder.
 *
 * This exists because `office-addin-debugging` cannot do it on macOS.
 * `office-addin-dev-settings/lib/dev-settings-mac.js` calls `ensureLinkSync`,
 * which bottoms out in `fs.linkSync` — a hard link — and `link(2)` fails with
 * EPERM into an app container, and again if the repo sits on a synced or
 * external volume, since hard links cannot cross filesystems. A copy has
 * neither problem, and `wef` is the sanctioned drop point.
 *
 * A copy, specifically — never a symlink. Microsoft's uninstall path resolves
 * entries with `realpathSync` before unlinking them, so a symlink here would
 * make `npm run stop` delete the repo's own manifest.xml.
 */

const addinRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(addinRoot, 'manifest.xml')

if (!existsSync(manifestPath)) {
  console.error(`Could not find ${manifestPath}`)
  process.exit(1)
}

if (process.platform !== 'darwin') {
  console.error(
    [
      `Automatic sideloading here only supports macOS (this is ${process.platform}).`,
      '',
      'On Windows, Word loads add-ins from a network shared folder configured as a',
      'trusted catalog: share a folder, add it under',
      '  File > Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs',
      `then copy ${manifestPath} into it and pick the add-in from`,
      '  Insert > My Add-ins > Shared Folder.',
    ].join('\n'),
  )
  process.exit(1)
}

const id = readManifestId(manifestPath)
const sideloadDirectory = wordSideloadDirectory(homedir())
const destination = join(sideloadDirectory, sideloadFilename(id))

mkdirSync(sideloadDirectory, { recursive: true })

try {
  copyFileSync(manifestPath, destination)
} catch (error) {
  // macOS protects another app's container under ~/Library/Containers, so the
  // terminal is refused even though it can read the source and stat the
  // directory. This is the likeliest way this script fails, and a raw stack
  // trace tells the reader nothing about the one setting that fixes it.
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error

  console.error(
    [
      `macOS refused to write into Word's add-in folder:`,
      `  ${destination}`,
      '',
      'Reading the manifest and finding the folder both worked, so this is the',
      "system withholding access to another app's container, not a bad path.",
      '',
      'To fix it, once:',
      '  1. System Settings > Privacy & Security > Full Disk Access',
      '  2. Add the terminal you run this from (Terminal, iTerm, VS Code…) and',
      '     switch it on.',
      '  3. Quit that terminal completely (Cmd+Q) and reopen it. The permission',
      '     is read when a process starts, so a running shell keeps the old',
      '     denial — this step is the one people skip.',
      '  4. On macOS 14 or newer, if it still fails, add it under',
      '     Privacy & Security > App Management as well.',
      '',
      'Check it took, without involving Word:',
      `  touch "${sideloadDirectory}/.permtest" && echo WRITABLE && rm "${sideloadDirectory}/.permtest"`,
      '',
      'Or sideload without granting anything — Finder is exempt, so dragging',
      'works where the terminal cannot:',
      `  open "${sideloadDirectory}"`,
      `  open "${addinRoot}"`,
      `  then drag manifest.xml across and rename it ${sideloadFilename(id)}`,
    ].join('\n'),
  )
  process.exit(1)
}

// Prove the copy landed rather than trusting a silent success.
const { size } = statSync(destination)

console.log(
  [
    `Sideloaded ${id} (${size} bytes)`,
    `  → ${destination}`,
    '',
    'Next:',
    '  1. Make sure the pane is serving (npm run dev, https://localhost:3100).',
    '  2. Quit Word completely (Cmd+Q) and reopen it — a running Word will not',
    '     rescan the sideload folder.',
    '  3. Insert > My Add-ins > Cornerstone, or the Cornerstone button on the',
    '     Home ribbon.',
    '',
    'This is a copy, not a live link: re-run `npm start` after editing manifest.xml.',
    'Run `npm run stop` to unregister.',
  ].join('\n'),
)
