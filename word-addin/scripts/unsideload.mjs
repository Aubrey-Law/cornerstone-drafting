import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readManifestId, sideloadFilename, wordSideloadDirectory } from './manifestId.mjs'

/** Undo `npm start`: remove this add-in's manifest from Word's sideload folder. */

const addinRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(addinRoot, 'manifest.xml')

if (process.platform !== 'darwin') {
  console.error(`Nothing to do: automatic sideloading only supports macOS (this is ${process.platform}).`)
  process.exit(0)
}

const id = readManifestId(manifestPath)
const registered = join(wordSideloadDirectory(homedir()), sideloadFilename(id))

if (!existsSync(registered)) {
  // Not an error: unregistering something already gone is the desired state.
  console.log(`Not sideloaded — nothing to remove at ${registered}`)
  process.exit(0)
}

rmSync(registered)
console.log(`Unregistered ${id}\n  removed ${registered}\n\nRestart Word for it to disappear from the ribbon.`)
