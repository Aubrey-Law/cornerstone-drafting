import { readFileSync } from 'node:fs'

/**
 * The add-in's GUID, read straight out of the manifest.
 *
 * A regex rather than an XML parser on purpose: this runs before any install
 * step is guaranteed, so it must not need a dependency. `<Id>` appears once in
 * an OfficeApp manifest and always as a plain element.
 */
export function readManifestId(manifestPath) {
  const xml = readFileSync(manifestPath, 'utf8')
  const match = xml.match(/<Id>\s*([0-9a-fA-F-]{36})\s*<\/Id>/)
  if (!match) {
    throw new Error(`No <Id> GUID found in ${manifestPath}`)
  }
  return match[1]
}

/**
 * Where Word looks for sideloaded add-ins.
 *
 * Word scans this whole folder and parses every file in it, so keep it free of
 * anything that is not a manifest.
 */
export function wordSideloadDirectory(homedir) {
  return `${homedir}/Library/Containers/com.microsoft.Word/Data/Documents/wef`
}

/**
 * Microsoft's own naming convention, matched deliberately.
 *
 * `office-addin-dev-settings` writes `<GUID>.<basename>` and its uninstall path
 * matches on `startsWith(addinId)`. Using the same name means its tooling and
 * these scripts can clean up after each other, and re-running overwrites the
 * existing registration instead of adding a second one.
 */
export function sideloadFilename(id) {
  return `${id}.manifest.xml`
}
