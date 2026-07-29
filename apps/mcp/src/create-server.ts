import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  ActorService,
  ProjectService,
} from '@project-os/core'
import { registerIdentityTools } from './tools/identity.js'
import { registerProjectTools } from './tools/projects.js'

export type ProjectOsMcpServices = {
  actors: ActorService
  projects: ProjectService
}

export function createProjectOsMcpServer(
  services: ProjectOsMcpServices,
): McpServer {
  const server = new McpServer({
    name: 'project-os',
    version: '0.1.0',
  })

  registerIdentityTools(server, services.actors)
  registerProjectTools(server, services)

  return server
}
