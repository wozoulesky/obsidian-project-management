import type {
  ActivityEvent,
  Actor,
  Defect,
  Requirement,
  RiskItem,
  Task,
  TrendPoint,
} from './domain'

export interface FixtureSeed {
  actors: Record<string, Actor>
  tasks: Task[]
  requirements: Requirement[]
  defects: Defect[]
  risks: RiskItem[]
  activities: ActivityEvent[]
  trendByDays: Record<7 | 30 | 90, TrendPoint[]>
}

function createActors(): Record<string, Actor> {
  return {
    lin: { id: 'human-lin', name: 'Lin', kind: 'human' },
    chen: { id: 'human-chen', name: 'Chen', kind: 'human' },
    dev: {
      id: 'dev-agent-7f3a',
      name: 'dev-agent',
      kind: 'agent',
      role: 'dev-agent',
    },
    qa: {
      id: 'qa-agent-2b91',
      name: 'qa-agent',
      kind: 'agent',
      role: 'qa-agent',
    },
    pm: {
      id: 'pm-agent-18ce',
      name: 'pm-agent',
      kind: 'agent',
      role: 'pm-agent',
    },
    maya: { id: 'human-maya', name: 'Maya', kind: 'human' },
  }
}

function createTasks(actors: Record<string, Actor>): Task[] {
  const namedTasks: Task[] = [
    {
      id: 'task-040',
      code: 'TASK-040',
      title: 'SQLite WAL 支持',
      description: '为本地项目存储启用 WAL 并覆盖并发读写。',
      assignee: actors.dev,
      startDate: '2026-07-20',
      dueDate: '2026-07-23',
      priority: 'P0',
      status: 'done',
      progress: 100,
      milestoneId: 'm2',
      dependencyIds: [],
    },
    {
      id: 'task-042',
      code: 'TASK-042',
      title: 'Agent 注册协议',
      description: '定义 Agent 身份注册的字段和校验规则。',
      assignee: actors.lin,
      startDate: '2026-07-21',
      dueDate: '2026-07-24',
      priority: 'P0',
      status: 'done',
      progress: 100,
      milestoneId: 'm2',
      dependencyIds: [],
    },
    {
      id: 'task-043',
      code: 'TASK-043',
      title: '身份注册审计日志',
      description: '记录 Agent 注册和权限变化。',
      assignee: actors.qa,
      startDate: '2026-07-22',
      dueDate: '2026-07-25',
      priority: 'P1',
      status: 'done',
      progress: 100,
      milestoneId: 'm2',
      dependencyIds: ['task-042'],
    },
    {
      id: 'task-051',
      code: 'TASK-051',
      title: 'MCP 权限校验',
      description:
        '服务端按 Agent 角色权限表拦截越权写操作，并返回明确错误信息。',
      assignee: actors.lin,
      startDate: '2026-07-24',
      dueDate: '2026-07-28',
      priority: 'P0',
      status: 'in_progress',
      progress: 62,
      milestoneId: 'm2',
      dependencyIds: ['task-040'],
    },
    {
      id: 'task-047',
      code: 'TASK-047',
      title: '断线恢复测试',
      description: '验证 Agent 断线后凭已有 agent_id 恢复身份。',
      assignee: actors.dev,
      startDate: '2026-07-25',
      dueDate: '2026-07-26',
      priority: 'P0',
      status: 'overdue',
      progress: 45,
      milestoneId: 'm2',
      dependencyIds: ['task-051'],
    },
    {
      id: 'task-052',
      code: 'TASK-052',
      title: 'Agent 身份恢复接口',
      description: '使用已有 agent_id 恢复 Agent 身份与项目权限。',
      assignee: actors.dev,
      startDate: '2026-07-24',
      dueDate: '2026-07-27',
      priority: 'P0',
      status: 'done',
      progress: 100,
      milestoneId: 'm2',
      dependencyIds: ['task-040'],
    },
    {
      id: 'task-063',
      code: 'TASK-063',
      title: '甘特图渲染',
      description: '渲染任务树、时间轴、今日线和里程碑。',
      assignee: actors.chen,
      startDate: '2026-07-31',
      dueDate: '2026-08-05',
      priority: 'P1',
      status: 'in_progress',
      progress: 70,
      milestoneId: 'm3',
      dependencyIds: ['task-047'],
    },
    {
      id: 'task-068',
      code: 'TASK-068',
      title: '风险卡片联动',
      description: '从风险卡片快速定位关联任务。',
      assignee: actors.pm,
      startDate: '2026-08-03',
      dueDate: '2026-08-06',
      priority: 'P2',
      status: 'not_started',
      progress: 0,
      milestoneId: 'm3',
      dependencyIds: ['task-063'],
    },
    {
      id: 'task-072',
      code: 'TASK-072',
      title: '验收报告生成',
      description: '汇总需求、任务和缺陷的验收结果。',
      assignee: actors.qa,
      startDate: '2026-08-06',
      dueDate: '2026-08-10',
      priority: 'P2',
      status: 'not_started',
      progress: 0,
      milestoneId: 'm3',
      dependencyIds: ['task-068'],
    },
  ]

  const assignees = Object.values(actors)
  const generatedTasks = Array.from({ length: 41 }, (_, index): Task => {
    const number = index + 101
    const done = index < 30
    const startDay = (index % 20) + 1
    return {
      id: `task-${number}`,
      code: `TASK-${number}`,
      title: `稳定性工作项 ${String(index + 1).padStart(2, '0')}`,
      description: '确定性生成的项目工作项，用于完整列表与指标校验。',
      assignee: assignees[index % assignees.length]!,
      startDate: `2026-08-${String(startDay).padStart(2, '0')}`,
      dueDate: `2026-08-${String(startDay + 2).padStart(2, '0')}`,
      priority: index % 3 === 0 ? 'P1' : 'P2',
      status: done ? 'done' : index % 2 === 0 ? 'in_progress' : 'not_started',
      progress: done ? 100 : index % 2 === 0 ? 40 : 0,
      milestoneId: index < 20 ? 'm3' : 'm4',
      dependencyIds: [],
    }
  })

  return [...namedTasks, ...generatedTasks]
}

function createRequirements(): Requirement[] {
  const namedRequirements: Requirement[] = [
    {
      id: 'req-013',
      code: 'REQ-013',
      title: 'Agent 身份注册',
      priority: 'P0',
      status: 'developing',
      linkedTaskIds: ['task-040', 'task-042', 'task-043', 'task-052'],
      completedTaskCount: 4,
      acceptanceCriteria: [
        '重复注册返回已有身份',
        '所有写操作携带 agent_id',
      ],
    },
    {
      id: 'req-017',
      code: 'REQ-017',
      title: '项目排期可视化',
      priority: 'P1',
      status: 'reviewed',
      linkedTaskIds: ['task-063', 'task-068'],
      completedTaskCount: 0,
      acceptanceCriteria: ['可按里程碑查看任务区间与依赖关系'],
    },
  ]
  const generatedRequirements = Array.from(
    { length: 18 },
    (_, index): Requirement => {
      const number = index + 101
      const delivered = index < 14
      return {
        id: `req-${number}`,
        code: `REQ-${number}`,
        title: `项目能力需求 ${String(index + 1).padStart(2, '0')}`,
        priority: index % 4 === 0 ? 'P1' : 'P2',
        status: delivered
          ? index % 2 === 0
            ? 'delivered'
            : 'accepted'
          : index % 2 === 0
            ? 'draft'
            : 'reviewed',
        linkedTaskIds: [`task-${index + 101}`],
        completedTaskCount: delivered && index < 30 ? 1 : 0,
        acceptanceCriteria: ['关联任务完成并通过验收'],
      }
    },
  )
  return [...namedRequirements, ...generatedRequirements]
}

function createDefects(actors: Record<string, Actor>): Defect[] {
  const namedDefects: Defect[] = [
    {
      id: 'defect-104',
      code: 'D-104',
      title: '离线恢复失败',
      severity: 'fatal',
      status: 'open',
      assignee: actors.dev,
      updatedAt: '2026-07-28T10:34:00+08:00',
      reproductionSteps: [
        '断开 MCP 客户端',
        '重新启动客户端',
        '使用已有 agent_id 查询身份',
      ],
      linkedTaskId: 'task-047',
      linkedRequirementId: 'req-013',
    },
    {
      id: 'defect-099',
      code: 'D-099',
      title: '甘特图标签截断',
      severity: 'normal',
      status: 'fixing',
      assignee: actors.chen,
      updatedAt: '2026-07-27T16:20:00+08:00',
      reproductionSteps: ['打开甘特图', '缩小浏览器窗口', '观察长标题被遮挡'],
      linkedTaskId: 'task-063',
    },
  ]
  const assignees = Object.values(actors)
  const generatedDefects = Array.from({ length: 5 }, (_, index): Defect => ({
    id: `defect-${200 + index}`,
    code: `D-${200 + index}`,
    title: `待处理缺陷 ${index + 1}`,
    severity: index === 0 ? 'serious' : index % 2 === 0 ? 'normal' : 'suggestion',
    status: index % 3 === 0 ? 'open' : index % 3 === 1 ? 'fixing' : 'verifying',
    assignee: assignees[(index + 2) % assignees.length]!,
    updatedAt: `2026-07-${String(23 + index).padStart(2, '0')}T09:00:00+08:00`,
    reproductionSteps: ['打开项目工作台', `执行确定性场景 ${index + 1}`, '观察异常结果'],
    linkedTaskId: `task-${101 + index}`,
  }))
  return [...namedDefects, ...generatedDefects]
}

export function createFixtureSeed(): FixtureSeed {
  const actors = createActors()
  const tasks = createTasks(actors)
  const requirements = createRequirements()
  const defects = createDefects(actors)
  const risks: RiskItem[] = [
    {
      id: 'risk-task-047',
      entityType: 'task',
      entityId: 'task-047',
      title: '断线恢复测试',
      assignee: actors.dev,
      progress: 45,
      dueDate: '2026-07-26',
      level: 'critical',
    },
    {
      id: 'risk-task-063',
      entityType: 'task',
      entityId: 'task-063',
      title: '甘特图渲染',
      assignee: actors.chen,
      progress: 70,
      dueDate: '2026-08-05',
      level: 'warning',
    },
  ]
  const activities: ActivityEvent[] = [
    {
      id: 'activity-1',
      actor: actors.dev,
      action: '将「SQLite WAL 支持」更新至 80%',
      operation: 'task.update',
      createdAt: '2026-07-28T10:40:00+08:00',
    },
    {
      id: 'activity-2',
      actor: actors.qa,
      action: '记录缺陷「离线恢复失败」',
      operation: 'defect.create',
      createdAt: '2026-07-28T10:34:00+08:00',
    },
  ]
  const trendByDays: Record<7 | 30 | 90, TrendPoint[]> = {
    7: [
      { date: '2026-07-22', actual: 5, planned: 6 },
      { date: '2026-07-23', actual: 6, planned: 7 },
      { date: '2026-07-24', actual: 7, planned: 8 },
      { date: '2026-07-25', actual: 8, planned: 9 },
      { date: '2026-07-26', actual: 9, planned: 11 },
      { date: '2026-07-27', actual: 10, planned: 12 },
      { date: '2026-07-28', actual: 11, planned: 13 },
    ],
    30: [
      { date: '2026-06-30', actual: 3, planned: 4 },
      { date: '2026-07-07', actual: 6, planned: 9 },
      { date: '2026-07-14', actual: 11, planned: 15 },
      { date: '2026-07-21', actual: 18, planned: 23 },
      { date: '2026-07-28', actual: 34, planned: 40 },
    ],
    90: [
      { date: '2026-04-30', actual: 24, planned: 22 },
      { date: '2026-05-31', actual: 55, planned: 54 },
      { date: '2026-06-30', actual: 84, planned: 86 },
      { date: '2026-07-14', actual: 101, planned: 102 },
      { date: '2026-07-28', actual: 118, planned: 114 },
    ],
  }

  return { actors, tasks, requirements, defects, risks, activities, trendByDays }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested)
    }
    Object.freeze(value)
  }
  return value
}

const compatibilitySeed = createFixtureSeed()

export const actors = deepFreeze(compatibilitySeed.actors)
export const tasks = deepFreeze(compatibilitySeed.tasks)
export const requirements = deepFreeze(compatibilitySeed.requirements)
export const defects = deepFreeze(compatibilitySeed.defects)
export const risks = deepFreeze(compatibilitySeed.risks)
export const activities = deepFreeze(compatibilitySeed.activities)
export const trendByDays = deepFreeze(compatibilitySeed.trendByDays)
