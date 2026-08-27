import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
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
copyFileSync(manifestPath, destination)

console.log(
  [
    `Sideloaded ${id}`,
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
