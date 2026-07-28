export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export type TaskStatus = 'not_started' | 'in_progress' | 'done' | 'overdue'

export type RequirementStatus =
  | 'draft'
  | 'reviewed'
  | 'developing'
  | 'delivered'
  | 'accepted'
  | 'rejected'
  | 'shelved'

export type DefectStatus =
  | 'open'
  | 'fixing'
  | 'verifying'
  | 'closed'
  | 'rejected'
  | 'not_a_defect'

export type Severity = 'fatal' | 'serious' | 'normal' | 'suggestion'

export type RiskLevel = 'critical' | 'warning'

export type ActorRole = 'pm-agent' | 'dev-agent' | 'qa-agent' | 'doc-agent'

export interface Actor {
  id: string
  name: string
  kind: 'human' | 'agent'
  role?: ActorRole
}

export interface Task {
  id: string
  code: string
  title: string
  description: string
  assignee: Actor
  startDate: string
  dueDate: string
  priority: Priority
  status: TaskStatus
  progress: number
  milestoneId: string
  parentId?: string
  dependencyIds: string[]
}

export interface Requirement {
  id: string
  code: string
  title: string
  priority: Priority
  status: RequirementStatus
  linkedTaskIds: string[]
  completedTaskCount: number
  acceptanceCriteria: string[]
}

export interface Defect {
  id: string
  code: string
  title: string
  severity: Severity
  status: DefectStatus
  assignee: Actor
  updatedAt: string
  reproductionSteps: string[]
  linkedTaskId?: string
  linkedRequirementId?: string
}

export interface TrendPoint {
  date: string
  actual: number
  planned: number
}

export type ActivityOperation =
  | 'task.update'
  | 'task.schedule'
  | 'requirement.update'
  | 'defect.create'

export interface ActivityEvent {
  id: string
  actor: Actor
  action: string
  operation: ActivityOperation
  createdAt: string
  note?: string
}

export interface RiskItem {
  id: string
  entityType: 'task' | 'requirement' | 'defect'
  entityId: string
  title: string
  assignee: Actor
  progress: number
  dueDate: string
  level: RiskLevel
}

export interface DashboardMetrics {
  totalTasks: number
  completedTasks: number
  deliveredRequirements: number
  totalRequirements: number
  activeDefects: number
  seriousDefects: number
  velocityPerWeek: number
  activeActors: number
  activeAgents: number
}

export interface DashboardSnapshot {
  metrics: DashboardMetrics
  taskStatusCounts: Record<TaskStatus, number>
  trend: TrendPoint[]
  risks: RiskItem[]
  activities: ActivityEvent[]
}

export interface TaskProgressInput {
  progress: number
  status: TaskStatus
  note: string
}

export interface TaskDateInput {
  startDate: string
  dueDate: string
}
