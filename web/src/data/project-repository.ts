import { prioritySchema } from '@project-os/contracts'
import { z } from 'zod'

import type {
  ActivityEvent,
  Actor,
  AppSettings,
  CreateProjectInput,
  DashboardSnapshot,
  Defect,
  Priority,
  Project,
  ProjectMember,
  Requirement,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
} from './domain'

const routeIdSchema = z.string().min(1).max(256)

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

export interface ProjectRepository {
  listActors(): Promise<Actor[]>
  listProjects(): Promise<Project[]>
  getProject(projectId: string): Promise<Project>
  listProjectMembers(projectId: string): Promise<ProjectMember[]>
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
  getSettings(): Promise<AppSettings>
}
