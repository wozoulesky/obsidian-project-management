import type {
  ActivityEvent,
  Actor,
  AppSettings,
  DashboardSnapshot,
  Defect,
  Project,
  Requirement,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
} from './domain'

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
