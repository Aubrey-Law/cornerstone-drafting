import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMattersClient, mattersClientConfig } from './client'
import { mergeEnvFile, readEnvFile, repoRootFrom } from './env'
import { registerTools } from './tools'

async function main(): Promise<void> {
  // Credentials come from the repository's own `.env.local` unless the
  // environment already carries them, so nothing secret has to be written into
  // `~/.claude.json`. Resolved from this module's location, not the working
  // directory, because the editor launches this from wherever it likes.
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const env = mergeEnvFile(process.env, readEnvFile(repoRootFrom(moduleDir)))

  // Configuration first, so a missing key fails here with its own name rather
  // than on the first tool call.
  const client = createMattersClient(mattersClientConfig(env))

  const server = new McpServer({ name: 'cornerstone-matters', version: '0.1.0' })
  registerTools(server, client)

  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  // stdout is the transport. Diagnostics must go to stderr or they corrupt the
  // protocol stream.
  console.error(error)
  process.exit(1)
})
