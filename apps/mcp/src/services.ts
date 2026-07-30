import type { DatabaseSync } from 'node:sqlite'
import {
  ActivityService,
  ActorService,
  BriefingService,
  DashboardService,
  DefectService,
  DeliverableService,
  HandoffService,
  ProjectService,
  RequirementService,
  SessionService,
  TaskService,
} from '@project-os/core'
import type { ProjectOsMcpServices } from './create-server.js'

export function createProjectOsMcpServices(
  database: DatabaseSync,
): ProjectOsMcpServices {
  return {
    activities: new ActivityService(database),
    actors: new ActorService(database),
    briefing: new BriefingService(database),
    dashboard: new DashboardService(database),
    defects: new DefectService(database),
    deliverables: new DeliverableService(database),
    handoffs: new HandoffService(database),
    projects: new ProjectService(database),
    requirements: new RequirementService(database),
    sessions: new SessionService(database),
    tasks: new TaskService(database),
  }
}
