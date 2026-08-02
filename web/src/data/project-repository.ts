import {
  humanActorRoleSchema,
  persistedActorSchema,
  prioritySchema,
} from '@project-os/contracts'
import { z } from 'zod'

import type {
  ActivityEvent,
  Actor,
  Accent,
  Background,
  CreateProjectInput,
  DashboardSnapshot,
  Deliverable,
  Defect,
  Handoff,
  Priority,
  Project,
  ProjectMember,
  Requirement,
  RequirementStatus,
  Session,
  Task,
  TaskDateInput,
  TaskProgressInput,
  Theme,
  Density,
} from './domain'
import type { PersistedAppSettings } from '@project-os/contracts'

const routeIdSchema = z.string().min(1).max(256)
const actorNameSchema = z.string().trim().min(1).max(200)
const actorCapabilitiesSchema = z.array(
  z.string().trim().min(1).max(200),
).max(100)

export const createHumanActorInputSchema = z.object({
  name: actorNameSchema,
  role: humanActorRoleSchema,
  capabilities: actorCapabilitiesSchema.optional(),
}).strict()

export type CreateHumanActorInput = z.infer<
  typeof createHumanActorInputSchema
>

export const updateActorInputSchema = z.object({
  name: actorNameSchema.optional(),
  role: humanActorRoleSchema.optional(),
  capabilities: actorCapabilitiesSchema.optional(),
  version: persistedActorSchema.options[0].shape.version,
}).strict()

export type UpdateActorInput = z.infer<typeof updateActorInputSchema>

export const createProjectTaskInputSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  assigneeId: routeIdSchema,
  startDate: z.iso.date(),
  dueDate: z.iso.date(),
  priority: prioritySchema,
  milestoneId: z.string().max(256).optional(),
}).strict().superRefine((input, context) => {
  if (input.startDate > input.dueDate) {
    context.addIssue({
      code: 'custom',
      message: 'Task start date must not be after its due date',
      path: ['dueDate'],
    })
  }
})

export type CreateProjectTaskInput = {
  title: string
  description?: string
  assigneeId: string
  startDate: string
  dueDate: string
  priority: Priority
  milestoneId?: string
}

export type ActivityListInput = {
  after?: string
  projectId?: string
}

export type ActivityPage = {
  items: ActivityEvent[]
  nextCursor: string | null
}

export type AppearanceSettingsInput = {
  theme: Theme
  background: Background
  accent: Accent
  density: Density
  version: number
}

export type HealthStatus = {
  status: 'ok'
  database: 'ok'
}

export type AccessTokenMetadata = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  version: number
}

export type IssuedAccessToken = AccessTokenMetadata & {
  token: string
}

export type BackupRecord = {
  filename: string
  path: string
}

export type ImportCounts = {
  ok: true
  counts: {
    actors: number
    projects: number
    projectMembers: number
    tasks: number
    requirements: number
    defects: number
    sessions: number
    handoffs: number
    deliverables: number
  }
}

export type SkillConfigClient = 'codex' | 'claude-code' | 'kimi-code'

export type SkillConfigSnippet = {
  client: SkillConfigClient
  transport: 'stdio'
  snippet: string
}

export interface ProjectRepository {
  listActors(): Promise<Actor[]>
  getCurrentActor(): Promise<Actor>
  createHuman(input: CreateHumanActorInput): Promise<Actor>
  updateActor(actorId: string, input: UpdateActorInput): Promise<Actor>
  deactivateActor(actorId: string, version: number): Promise<Actor>
  listProjects(): Promise<Project[]>
  getProject(projectId: string): Promise<Project>
  listProjectMembers(projectId: string): Promise<ProjectMember[]>
  listProjectSessions(projectId: string): Promise<Session[]>
  listProjectHandoffs(projectId: string): Promise<Handoff[]>
  listProjectDeliverables(projectId: string): Promise<Deliverable[]>
  createProject(input: CreateProjectInput): Promise<Project>
  createTask(
    projectId: string,
    input: CreateProjectTaskInput,
  ): Promise<Task>
  listAllTasks(): Promise<Task[]>
  getDashboard(
    projectId: string,
    days?: 7 | 30 | 90,
  ): Promise<DashboardSnapshot>
  getWorkspaceDashboard(days?: 7 | 30 | 90): Promise<DashboardSnapshot>
  listTasks(projectId: string): Promise<Task[]>
  updateTaskProgress(taskId: string, input: TaskProgressInput): Promise<Task>
  updateTaskDates(taskId: string, input: TaskDateInput): Promise<Task>
  listRequirements(projectId: string): Promise<Requirement[]>
  updateRequirementStatus(
    requirementId: string,
    status: RequirementStatus,
  ): Promise<Requirement>
  listDefects(projectId: string): Promise<Defect[]>
  createTaskFromDefect(defectId: string): Promise<Task>
  listGanttTasks(projectId: string): Promise<Task[]>
  listActivities(input?: ActivityListInput): Promise<ActivityPage>
  getSettings(): Promise<PersistedAppSettings>
  updateSettings(input: AppearanceSettingsInput): Promise<PersistedAppSettings>
  getHealth(): Promise<HealthStatus>
  listTokens(): Promise<AccessTokenMetadata[]>
  issueToken(name: string): Promise<IssuedAccessToken>
  revokeToken(tokenId: string, version: number): Promise<AccessTokenMetadata>
  createBackup(filename?: string): Promise<BackupRecord>
  restoreBackup(filename: string): Promise<BackupRecord>
  exportData(): Promise<unknown>
  importData(file: File): Promise<ImportCounts>
  downloadSkill(): Promise<Blob>
  getSkillConfigSnippet(
    client: SkillConfigClient,
  ): Promise<SkillConfigSnippet>
}
