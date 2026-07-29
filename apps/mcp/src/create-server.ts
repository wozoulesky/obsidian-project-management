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
import { inputInvalidResult } from './tool-result.js'

export type ProjectOsMcpServices = {
  activities: ActivityService
  actors: ActorService
  dashboard: DashboardService
  defects: DefectService
  projects: ProjectService
  requirements: RequirementService
  tasks: TaskService
}

function installStructuredInputErrors(server: McpServer): void {
  const internals = server as unknown as {
    createToolError: (message: string) => unknown
  }
  const createToolError = internals.createToolError.bind(server)

  // SDK 1.29 formats pre-handler validation failures as unstructured tool
  // errors. This compatibility seam changes only that error result while
  // preserving the strict advertised schema and the SDK validation path.
  internals.createToolError = (message) => {
    return message.includes('Input validation error:')
      ? inputInvalidResult()
      : createToolError(message)
  }
}

export function createProjectOsMcpServer(
  services: ProjectOsMcpServices,
): McpServer {
  const server = new McpServer({
    name: 'project-os',
    version: '0.1.0',
  })

  installStructuredInputErrors(server)
  registerIdentityTools(server, services.actors)
  registerProjectTools(server, services)
  registerTaskTools(server, services)
  registerRequirementTools(server, services)
  registerDefectTools(server, services)
  registerReportTools(server, services)

  return server
}
