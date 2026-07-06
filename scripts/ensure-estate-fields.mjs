// Ensures @aubrey-law/estate-fields is available for the file: dependency in
// package.json. Local monorepo dev uses ../aubrey-law-app; Vercel and other
// standalone clones sparse-fetch that package before npm links dependencies.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const estateFieldsDir = join(root, '..', 'aubrey-law-app', 'packages', 'estate-fields')
const estateFieldsPackage = join(estateFieldsDir, 'package.json')
const repoDir = join(root, '..', 'aubrey-law-app')
const repoUrl = 'https://github.com/spaubrey/aubrey-law-app.git'

if (process.env.ESTATE_FIELDS_SKIP_FETCH === '1') {
  process.exit(0)
}

if (existsSync(estateFieldsPackage)) {
  console.log('ensure-estate-fields: using local ../aubrey-law-app/packages/estate-fields')
  process.exit(0)
}

console.log('ensure-estate-fields: fetching packages/estate-fields from GitHub...')

if (existsSync(repoDir)) {
  execSync(`rm -rf ${JSON.stringify(repoDir)}`, { stdio: 'inherit' })
}

execSync(
  `git clone --depth 1 --filter=blob:none --sparse ${repoUrl} ${JSON.stringify(repoDir)}`,
  { stdio: 'inherit' },
)
execSync('git sparse-checkout set packages/estate-fields', {
  cwd: repoDir,
  stdio: 'inherit',
})

if (!existsSync(estateFieldsPackage)) {
  console.error('ensure-estate-fields: sparse checkout did not produce packages/estate-fields')
  process.exit(1)
}

console.log('ensure-estate-fields: ready')
