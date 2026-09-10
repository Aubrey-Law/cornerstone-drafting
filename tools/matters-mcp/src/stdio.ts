import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMattersClient, mattersClientConfig } from './client'
import { registerTools } from './tools'

async function main(): Promise<void> {
  // Configuration first, so a missing key fails here with its own name rather
  // than on the first tool call.
  const client = createMattersClient(mattersClientConfig(process.env))

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
