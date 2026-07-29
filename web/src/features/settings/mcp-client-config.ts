import { webRuntimeConfig } from '../../app/runtime-config'

export function createMcpClientSnippets(mcpUrl: string) {
  return {
    'Codex': `[mcp_servers.project-os]
url = "${mcpUrl}"`,
    'Claude Code':
      `claude mcp add --transport http project-os ${mcpUrl}`,
    'Kimi Code': `{
  "mcpServers": {
    "project-os": { "url": "${mcpUrl}" }
  }
}`,
  } as const
}

export const mcpClientSnippets =
  createMcpClientSnippets(webRuntimeConfig.mcpUrl)
