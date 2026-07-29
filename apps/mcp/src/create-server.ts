import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  ActivityService,
  ActorService,
  DashboardService,
  DefectService,
  ProjectService,
  RequirementService,
  TaskService,
} from '@project-os/core'
import { registerDefectTools } from './tools/defects.js'
import { registerIdentityTools } from './tools/identity.js'
import { registerProjectTools } from './tools/projects.js'
import { registerReportTools } from './tools/reports.js'
import { registerRequirementTools } from './tools/requirements.js'
import { registerTaskTools } from './tools/tasks.js'

export type ProjectOsMcpServices = {
  activities: ActivityService
  actors: ActorService
  dashboard: DashboardService
  defects: DefectService
  projects: ProjectService
  requirements: RequirementService
  tasks: TaskService
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
  registerTaskTools(server, services)
  registerRequirementTools(server, services)
  registerDefectTools(server, services)
  registerReportTools(server, services)

  return server
}
