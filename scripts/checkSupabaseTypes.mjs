import { readFileSync } from 'node:fs'

const source = readFileSync('types/supabase.generated.ts', 'utf8')
const compatibility = readFileSync('types/supabase.ts', 'utf8')
const requiredFragments = [
  'PostgrestVersion:',
  'client_intake: {',
  'contacts: {',
  'matters: {',
  'citizenship_status: string | null',
  'matter_type: string | null',
]

const failures = []
if (source.includes('type AnyTable')) failures.push('generated schema contains permissive AnyTable placeholder')
if (!compatibility.includes("export type { Database as GeneratedDatabase")) {
  failures.push('compatibility adapter does not expose GeneratedDatabase')
}
for (const fragment of requiredFragments) {
  if (!source.includes(fragment)) failures.push(`missing generated schema fragment: ${fragment}`)
}

if (failures.length > 0) {
  console.error(`Supabase type check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Supabase types are generated and include pending field-owner columns.')
