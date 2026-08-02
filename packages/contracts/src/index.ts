import { z } from 'zod'

const idSchema = z.string().min(1)
const dateSchema = z.iso.date()
const timestampSchema = z.iso.datetime({ offset: false })
const versionSchema = z.number().int().positive()
const progressSchema = z.number().int().min(0).max(100)

export const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])
export type Priority = z.infer<typeof prioritySchema>

export const taskStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'done',
  'overdue',
])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const requirementStatusSchema = z.enum([
  'draft',
  'reviewed',
  'developing',
  'delivered',
  'accepted',
  'rejected',
  'shelved',
])
export type RequirementStatus = z.infer<typeof requirementStatusSchema>

export const defectStatusSchema = z.enum([
  'open',
  'fixing',
  'verifying',
  'closed',
  'rejected',
  'not_a_defect',
])
export type DefectStatus = z.infer<typeof defectStatusSchema>

export const severitySchema = z.enum([
  'fatal',
  'serious',
  'normal',
  'suggestion',
])
export type Severity = z.infer<typeof severitySchema>

export const riskLevelSchema = z.enum(['critical', 'warning'])
export type RiskLevel = z.infer<typeof riskLevelSchema>

export const actorStatusSchema = z.enum(['active', 'inactive'])
export type ActorStatus = z.infer<typeof actorStatusSchema>

export const humanActorRoleSchema = z.enum(['owner', 'member'])
export const agentActorRoleSchema = z.enum([
  'pm-agent',
  'dev-agent',
  'qa-agent',
  'doc-agent',
])
export const actorRoleSchema = z.union([
  humanActorRoleSchema,
  agentActorRoleSchema,
])
export type ActorRole = z.infer<typeof actorRoleSchema>

const actorPersistenceFields = {
  status: actorStatusSchema.optional(),
  client: z.string().min(1).nullable().optional(),
  capabilities: z.array(z.string()).optional(),
  registeredAt: timestampSchema.optional(),
  lastActiveAt: timestampSchema.nullable().optional(),
  version: versionSchema.optional(),
}

export const actorSchema = z.discriminatedUnion('kind', [
  z.object({
    id: idSchema,
    name: z.string().min(1),
    kind: z.literal('human'),
    role: humanActorRoleSchema.optional(),
    ...actorPersistenceFields,
  }),
  z.object({
    id: idSchema,
    name: z.string().min(1),
    kind: z.literal('agent'),
    role: agentActorRoleSchema.optional(),
    ...actorPersistenceFields,
  }),
])
export type Actor = z.infer<typeof actorSchema>

const requiredActorPersistenceFields = {
  status: actorStatusSchema,
  client: z.string().min(1).nullable().optional(),
  capabilities: z.array(z.string()).default([]),
  registeredAt: timestampSchema,
  lastActiveAt: timestampSchema.nullable(),
  lastBriefingActivityId: idSchema.nullable(),
  version: versionSchema,
}

export const persistedActorSchema = z.discriminatedUnion('kind', [
  z.object({
    id: idSchema,
    name: z.string().min(1),
    kind: z.literal('human'),
    role: humanActorRoleSchema,
    ...requiredActorPersistenceFields,
  }),
  z.object({
    id: idSchema,
    name: z.string().min(1),
    kind: z.literal('agent'),
    role: agentActorRoleSchema,
    ...requiredActorPersistenceFields,
  }),
])
export type PersistedActor = z.infer<typeof persistedActorSchema>

export const sessionStatusSchema = z.enum(['active', 'abandoned', 'closed'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const deliverableKindSchema = z.enum(['commit', 'file', 'url', 'note'])
export type DeliverableKind = z.infer<typeof deliverableKindSchema>

export const handoffRefSchema = z.object({
  kind: deliverableKindSchema,
  ref: z.string().min(1),
  note: z.string().optional(),
})
export type HandoffRef = z.infer<typeof handoffRefSchema>

export const sessionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  agentId: idSchema,
  agent: actorSchema,
  intent: z.string().min(1),
  taskIds: z.array(idSchema),
  status: sessionStatusSchema,
  summary: z.string().nullable(),
  createdAt: timestampSchema,
  lastActiveAt: timestampSchema,
  closedAt: timestampSchema.nullable(),
})
export type Session = z.infer<typeof sessionSchema>
export const persistedSessionSchema = sessionSchema
export type PersistedSession = Session

export const handoffSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sessionId: idSchema.nullable(),
  author: actorSchema,
  summary: z.string().min(1),
  done: z.array(z.string()),
  blockers: z.array(z.string()),
  nextSteps: z.array(z.string()),
  gotchas: z.array(z.string()),
  refs: z.array(handoffRefSchema),
  createdAt: timestampSchema,
})
export type Handoff = z.infer<typeof handoffSchema>

export const deliverableSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  requirementId: idSchema.nullable(),
  taskId: idSchema.nullable(),
  title: z.string().min(1),
  kind: deliverableKindSchema,
  ref: z.string().min(1),
  note: z.string().nullable(),
  createdBy: actorSchema,
  sessionId: idSchema.nullable(),
  createdAt: timestampSchema,
})
export type Deliverable = z.infer<typeof deliverableSchema>

export const projectStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
])
export type ProjectStatus = z.infer<typeof projectStatusSchema>

export const projectSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  ownerId: idSchema,
  startDate: dateSchema.nullable(),
  dueDate: dateSchema.nullable(),
  status: projectStatusSchema,
  progress: progressSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
})
export type Project = z.infer<typeof projectSchema>
export const persistedProjectSchema = projectSchema
export type PersistedProject = Project

export const createProjectInputSchema = projectSchema.omit({
  id: true,
  code: true,
  status: true,
  progress: true,
  createdAt: true,
  updatedAt: true,
  version: true,
})
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>

export const projectIdParamsSchema = z.object({
  id: idSchema,
}).strict()
export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>

export const deleteProjectInputSchema = z.object({
  version: versionSchema,
}).strict()
export type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>

export const deleteProjectResultSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  deletedAt: timestampSchema,
  deletedCounts: z.object({
    project_members: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    requirements: z.number().int().nonnegative(),
    defects: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    handoffs: z.number().int().nonnegative(),
    deliverables: z.number().int().nonnegative(),
  }).strict(),
}).strict()
export type DeleteProjectResult = z.infer<typeof deleteProjectResultSchema>

export const projectMembershipRoleSchema = z.enum(['owner', 'member'])
export type ProjectMembershipRole = z.infer<
  typeof projectMembershipRoleSchema
>

export const projectMemberSchema = z.object({
  projectId: idSchema,
  actorId: idSchema,
  membershipRole: projectMembershipRoleSchema,
  joinedAt: timestampSchema.optional(),
})
export type ProjectMember = z.infer<typeof projectMemberSchema>

export const persistedProjectMemberSchema = projectMemberSchema.extend({
  joinedAt: timestampSchema,
})
export type PersistedProjectMember = z.infer<
  typeof persistedProjectMemberSchema
>

export const taskSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  assignee: actorSchema,
  startDate: dateSchema,
  dueDate: dateSchema,
  priority: prioritySchema,
  status: taskStatusSchema,
  progress: progressSchema,
  milestoneId: z.string(),
  parentId: idSchema.optional(),
  dependencyIds: z.array(idSchema),
  projectId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  version: versionSchema.optional(),
})
export type Task = z.infer<typeof taskSchema>

export const persistedTaskSchema = taskSchema.extend({
  projectId: idSchema,
  assigneeId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
})
export type PersistedTask = z.infer<typeof persistedTaskSchema>

export const requirementSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  priority: prioritySchema,
  status: requirementStatusSchema,
  linkedTaskIds: z.array(idSchema),
  completedTaskCount: z.number().int().nonnegative(),
  acceptanceCriteria: z.array(z.string()),
  projectId: idSchema.optional(),
  description: z.string().optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  version: versionSchema.optional(),
})
export type Requirement = z.infer<typeof requirementSchema>

export const persistedRequirementSchema = requirementSchema.extend({
  projectId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
})
export type PersistedRequirement = z.infer<
  typeof persistedRequirementSchema
>

export const defectSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  severity: severitySchema,
  status: defectStatusSchema,
  assignee: actorSchema,
  updatedAt: timestampSchema,
  reproductionSteps: z.array(z.string()),
  linkedTaskId: idSchema.optional(),
  linkedRequirementId: idSchema.optional(),
  projectId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  description: z.string().optional(),
  createdAt: timestampSchema.optional(),
  version: versionSchema.optional(),
})
export type Defect = z.infer<typeof defectSchema>

export const persistedDefectSchema = defectSchema.extend({
  projectId: idSchema,
  assigneeId: idSchema,
  createdAt: timestampSchema,
  version: versionSchema,
})
export type PersistedDefect = z.infer<typeof persistedDefectSchema>

export const activityOperationSchema = z.enum([
  'actor.create',
  'actor.update',
  'actor.deactivate',
  'actor.register',
  'project.create',
  'project.update',
  'project.delete',
  'project.member.add',
  'task.create',
  'task.update',
  'task.schedule',
  'task.progress',
  'requirement.create',
  'requirement.update',
  'defect.create',
  'defect.update',
  'defect.to_task',
  'settings.update',
  'backup.create',
  'backup.restore',
  'import.run',
  'token.issue',
  'token.revoke',
  'session.checkin',
  'session.note',
  'session.checkout',
  'handoff.update',
  'deliverable.record',
])
export type ActivityOperation = z.infer<typeof activityOperationSchema>

export const activitySourceSchema = z.enum(['web', 'mcp'])
export type ActivitySource = z.infer<typeof activitySourceSchema>

export const activitySchema = z.object({
  id: idSchema,
  actor: actorSchema,
  action: z.string().min(1),
  operation: activityOperationSchema,
  createdAt: timestampSchema,
  note: z.string().optional(),
  actorId: idSchema.optional(),
  projectId: idSchema.nullable().optional(),
  source: activitySourceSchema.optional(),
  entityType: z.string().min(1).optional(),
  entityId: idSchema.optional(),
})
export type Activity = z.infer<typeof activitySchema>
export type ActivityEvent = Activity

export const persistedActivitySchema = activitySchema.extend({
  actorId: idSchema,
  source: activitySourceSchema,
  entityType: z.string().min(1),
  entityId: idSchema,
})
export type PersistedActivity = z.infer<typeof persistedActivitySchema>

export const projectBriefingSchema = z.object({
  project: persistedProjectSchema,
  my_tasks: z.array(taskSchema),
  in_progress_tasks: z.array(
    z.object({
      task: taskSchema,
      latest_progress: z
        .object({
          note: z.string(),
          actor_name: z.string().min(1),
          created_at: timestampSchema,
        })
        .nullable(),
    }),
  ),
  unclaimed_tasks: z.array(taskSchema),
  sessions: z.array(sessionSchema),
  latest_handoff: handoffSchema.nullable(),
  recent_deliverables: z.array(deliverableSchema),
  new_activities: z.array(activitySchema),
  activities_truncated: z.boolean(),
  activity_cursor: idSchema.nullable(),
})
export type ProjectBriefing = z.infer<typeof projectBriefingSchema>

export const trendPointSchema = z.object({
  date: dateSchema,
  actual: z.number(),
  planned: z.number(),
})
export type TrendPoint = z.infer<typeof trendPointSchema>

export const riskItemSchema = z.object({
  id: idSchema,
  entityType: z.enum(['task', 'requirement', 'defect']),
  entityId: idSchema,
  title: z.string().min(1),
  assignee: actorSchema,
  progress: progressSchema,
  dueDate: dateSchema,
  level: riskLevelSchema,
})
export type RiskItem = z.infer<typeof riskItemSchema>

export const dashboardMetricsSchema = z.object({
  totalTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  deliveredRequirements: z.number().int().nonnegative(),
  totalRequirements: z.number().int().nonnegative(),
  activeDefects: z.number().int().nonnegative(),
  seriousDefects: z.number().int().nonnegative(),
  velocityPerWeek: z.number().nonnegative(),
  activeActors: z.number().int().nonnegative(),
  activeAgents: z.number().int().nonnegative(),
})
export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>

export const dashboardSnapshotSchema = z.object({
  metrics: dashboardMetricsSchema,
  taskStatusCounts: z.record(taskStatusSchema, z.number().int().nonnegative()),
  trend: z.array(trendPointSchema),
  risks: z.array(riskItemSchema),
  activities: z.array(activitySchema),
})
export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>

export const themeSchema = z.enum(['light', 'dark', 'system'])
export type Theme = z.infer<typeof themeSchema>
export const backgroundSchema = z.enum(['solid', 'soft', 'gradient'])
export type Background = z.infer<typeof backgroundSchema>
export const accentSchema = z.enum(['blue', 'teal', 'purple', 'orange'])
export type Accent = z.infer<typeof accentSchema>
export const densitySchema = z.enum(['comfortable', 'compact'])
export type Density = z.infer<typeof densitySchema>

export const appSettingsSchema = z.object({
  theme: themeSchema,
  background: backgroundSchema,
  accent: accentSchema,
  density: densitySchema,
  updatedAt: timestampSchema.optional(),
  version: versionSchema.optional(),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const persistedAppSettingsSchema = appSettingsSchema.extend({
  updatedAt: timestampSchema,
  version: versionSchema,
})
export type PersistedAppSettings = z.infer<
  typeof persistedAppSettingsSchema
>

export const taskProgressInputSchema = z.object({
  progress: progressSchema,
  status: taskStatusSchema,
  note: z.string(),
  version: versionSchema.optional(),
})
export type TaskProgressInput = z.infer<typeof taskProgressInputSchema>

export const persistedTaskProgressInputSchema = taskProgressInputSchema.extend({
  version: versionSchema,
})
export type PersistedTaskProgressInput = z.infer<
  typeof persistedTaskProgressInputSchema
>

export const sessionCheckinInputSchema = z.object({
  projectId: idSchema,
  agentId: idSchema,
  intent: z.string().min(1),
  taskIds: z.array(idSchema).max(20),
})
export type SessionCheckinInput = z.infer<typeof sessionCheckinInputSchema>

export const sessionNoteInputSchema = z.object({
  sessionId: idSchema,
  agentId: idSchema,
  note: z.string().min(1),
  taskId: idSchema.optional(),
})
export type SessionNoteInput = z.infer<typeof sessionNoteInputSchema>

export const sessionCheckoutInputSchema = z.object({
  sessionId: idSchema,
  agentId: idSchema,
  summary: z.string().min(1),
  done: z.array(z.string()),
  blockers: z.array(z.string()),
  nextSteps: z.array(z.string()),
  gotchas: z.array(z.string()),
  refs: z.array(handoffRefSchema),
})
export type SessionCheckoutInput = z.infer<
  typeof sessionCheckoutInputSchema
>

export const deliverableRecordInputSchema = z
  .object({
    projectId: idSchema,
    agentId: idSchema,
    title: z.string().min(1),
    kind: deliverableKindSchema,
    ref: z.string().min(1),
    requirementId: idSchema.optional(),
    taskId: idSchema.optional(),
    sessionId: idSchema.optional(),
    note: z.string().optional(),
  })
  .refine(
    ({ requirementId, taskId }) =>
      requirementId !== undefined || taskId !== undefined,
    {
      message: 'requirementId or taskId is required',
      path: ['requirementId'],
    },
  )
export type DeliverableRecordInput = z.infer<
  typeof deliverableRecordInputSchema
>

export const taskDateInputSchema = z.object({
  startDate: dateSchema,
  dueDate: dateSchema,
  version: versionSchema.optional(),
})
export type TaskDateInput = z.infer<typeof taskDateInputSchema>

export const paginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
})
export type Pagination = z.infer<typeof paginationSchema>

export const paginationMetaSchema = z.object({
  nextCursor: z.string().min(1).nullable(),
})
export type PaginationMeta = z.infer<typeof paginationMetaSchema>

export function paginatedSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return z.object({
    items: z.array(itemSchema),
    pagination: paginationMetaSchema,
  })
}

export type Paginated<T> = {
  items: T[]
  pagination: PaginationMeta
}

export const apiEnvelopeMetaSchema = z.object({
  request_id: z.string().min(1),
}).strict()
export type ApiEnvelopeMeta = z.infer<typeof apiEnvelopeMetaSchema>

export function apiSuccessEnvelopeSchema<DataSchema extends z.ZodType>(
  dataSchema: DataSchema,
) {
  return z.object({
    data: dataSchema,
    error: z.null(),
    meta: apiEnvelopeMetaSchema,
  }).strict()
}

export type ApiSuccessEnvelope<T> = {
  data: T
  error: null
  meta: ApiEnvelopeMeta
}

export const apiErrorEnvelopeSchema = z.object({
  data: z.null(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()),
  }).strict(),
  meta: apiEnvelopeMetaSchema,
}).strict()
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>
