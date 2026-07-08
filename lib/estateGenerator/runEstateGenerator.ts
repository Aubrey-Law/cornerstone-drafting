import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import {
  formatEstateGeneratorExecError,
  resolveEstateGeneratorPythonCommand,
  resolveEstateGeneratorRoot,
} from '@/lib/estateGenerator/runtime'
import {
  clientSlugFromPayload,
  deriveEstateGeneratorPackages,
  estateGeneratorCoverageWarnings,
  toEstateGeneratorData,
  type EstateGeneratorPackage,
} from '@/lib/estateGenerator/toGeneratorData'

const execFileAsync = promisify(execFile)

export interface EstateGeneratorFile {
  name: string
  buffer: Buffer
}

export type EstateGeneratorResult =
  | {
      ok: true
      files: EstateGeneratorFile[]
      missing: string[]
      warnings: string[]
      packageName: EstateGeneratorPackage
      packageNames: EstateGeneratorPackage[]
      clientSlug: string
    }
  | {
      ok: false
      error: string
      status: number
      missing?: string[]
      warnings?: string[]
    }

interface GenerationReport {
  output_files?: string[]
  missing_fields?: string[]
  unresolved_markers?: string[]
  warnings?: string[]
  errors?: string[]
}

function reportMessage(report: GenerationReport): string {
  const pieces = [
    ...(report.errors ?? []),
    ...(report.missing_fields?.length ? [`Missing fields: ${report.missing_fields.join(', ')}`] : []),
    ...(report.unresolved_markers?.length ? [`Unresolved markers: ${report.unresolved_markers.join(', ')}`] : []),
  ]
  return pieces.join('; ') || 'Estate generator failed'
}

async function readReport(outDir: string): Promise<GenerationReport | null> {
  try {
    return JSON.parse(await readFile(path.join(outDir, 'generation-report.json'), 'utf8')) as GenerationReport
  } catch {
    return null
  }
}

export async function generateEstatePlanDocuments(payload: DraftPayload): Promise<EstateGeneratorResult> {
  const root = resolveEstateGeneratorRoot()
  const packageNames = deriveEstateGeneratorPackages(payload)
  const packageName = packageNames[0]
  const clientSlug = clientSlugFromPayload(payload)
  const coverageWarnings = estateGeneratorCoverageWarnings(payload)

  if (!packageName) {
    return {
      ok: false,
      error: coverageWarnings[0] ?? 'No supported estate generator packages were selected for this matter.',
      status: 422,
      warnings: coverageWarnings,
    }
  }

  const runDir = await mkdtemp(path.join(tmpdir(), `estate-generator-${payload.matter.id}-`))
  const dataPath = path.join(runDir, 'client.json')
  const outRoot = path.join(runDir, 'output')

  await mkdir(outRoot, { recursive: true })
  await writeFile(dataPath, JSON.stringify(toEstateGeneratorData(payload), null, 2), 'utf8')

  const files: EstateGeneratorFile[] = []
  const missing: string[] = []
  const warnings: string[] = [...coverageWarnings]

  for (const currentPackage of packageNames) {
    const outDir = path.join(outRoot, currentPackage)

    try {
      await mkdir(outDir, { recursive: true })
      await execFileAsync(
        resolveEstateGeneratorPythonCommand({ root }),
        [
          path.join(root, 'al-generator.py'),
          'generate',
          '--data',
          dataPath,
          '--package',
          currentPackage,
          '--state',
          normalizeJurisdictionStateCode(payload.client.state),
          '--out',
          outDir,
          '--allow-draft',
        ],
        {
          cwd: root,
          timeout: Number(process.env.ESTATE_GENERATOR_TIMEOUT_MS ?? 120000),
          maxBuffer: 1024 * 1024 * 4,
        },
      )
    } catch (error) {
      const report = await readReport(outDir)
      const detail = report ? reportMessage(report) : formatEstateGeneratorExecError(error)
      return {
        ok: false,
        error: `${currentPackage}: ${detail}`,
        status: report?.missing_fields?.length ? 422 : 500,
        missing: report?.missing_fields ?? [],
        warnings: report?.warnings ?? [],
      }
    }

    const report = await readReport(outDir)
    if (report?.errors?.length || report?.missing_fields?.length || report?.unresolved_markers?.length) {
      return {
        ok: false,
        error: `${currentPackage}: ${reportMessage(report)}`,
        status: report.missing_fields?.length ? 422 : 500,
        missing: report.missing_fields ?? [],
        warnings: report.warnings ?? [],
      }
    }

    missing.push(...(report?.missing_fields ?? []))
    warnings.push(...(report?.warnings ?? []))

    const names = (await readdir(outDir)).filter(name => name.toLowerCase().endsWith('.docx')).sort()
    const packageFiles = await Promise.all(names.map(async name => ({
      name,
      buffer: await readFile(path.join(outDir, name)),
    })))
    files.push(...packageFiles)
  }

  if (!files.length) {
    return {
      ok: false,
      error: 'Estate generator completed but did not produce any DOCX files',
      status: 422,
      warnings,
    }
  }

  return {
    ok: true,
    files,
    missing,
    warnings,
    packageName,
    packageNames,
    clientSlug,
  }
}
