import type { DatabaseSync } from 'node:sqlite'
import {
  ActivityService,
  ActorService,
  DashboardService,
  DefectService,
  ProjectService,
  RequirementService,
  TaskService,
} from '@project-os/core'
import type { ProjectOsMcpServices } from './create-server.js'

export function createProjectOsMcpServices(
  database: DatabaseSync,
): ProjectOsMcpServices {
  return {
    activities: new ActivityService(database),
    actors: new ActorService(database),
    dashboard: new DashboardService(database),
    defects: new DefectService(database),
    projects: new ProjectService(database),
    requirements: new RequirementService(database),
    tasks: new TaskService(database),
  }
}
