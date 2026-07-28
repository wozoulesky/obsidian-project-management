import type {
  ActivityEvent,
  Actor,
  Defect,
  Requirement,
  RiskItem,
  Task,
  TrendPoint,
} from './domain'

const lin = {
  id: 'actor-lin',
  name: 'Lin',
  kind: 'human',
} satisfies Actor

const chen = {
  id: 'actor-chen',
  name: 'Chen',
  kind: 'human',
} satisfies Actor

const devAgent = {
  id: 'actor-dev-agent',
  name: 'dev-agent',
  kind: 'agent',
  role: 'dev-agent',
} satisfies Actor

const qaAgent = {
  id: 'actor-qa-agent',
  name: 'qa-agent',
  kind: 'agent',
  role: 'qa-agent',
} satisfies Actor

const pmAgent = {
  id: 'actor-pm-agent',
  name: 'pm-agent',
  kind: 'agent',
  role: 'pm-agent',
} satisfies Actor

export const actors: Actor[] = [lin, chen, devAgent, qaAgent, pmAgent]

export const tasks: Task[] = [
  {
    id: 'task-040',
    code: 'TASK-040',
    title: 'SQLite WAL 支持',
    description: '为本地项目存储启用 WAL 并覆盖并发读写。',
    assignee: devAgent,
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
    assignee: lin,
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
    assignee: qaAgent,
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
    description: '校验 Agent 调用 MCP 工具时的项目级权限。',
    assignee: lin,
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
    description: '验证网络中断后的任务恢复和状态一致性。',
    assignee: devAgent,
    startDate: '2026-07-25',
    dueDate: '2026-07-26',
    priority: 'P0',
    status: 'overdue',
    progress: 45,
    milestoneId: 'm2',
    dependencyIds: ['task-051'],
  },
  {
    id: 'task-063',
    code: 'TASK-063',
    title: '甘特图渲染',
    description: '渲染任务区间、依赖关系和里程碑。',
    assignee: chen,
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
    assignee: pmAgent,
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
    assignee: qaAgent,
    startDate: '2026-08-06',
    dueDate: '2026-08-10',
    priority: 'P2',
    status: 'not_started',
    progress: 0,
    milestoneId: 'm3',
    dependencyIds: ['task-068'],
  },
]

export const requirements: Requirement[] = [
  {
    id: 'req-013',
    code: 'REQ-013',
    title: 'Agent 身份注册',
    priority: 'P0',
    status: 'developing',
    linkedTaskIds: ['task-040', 'task-042', 'task-043', 'task-051'],
    completedTaskCount: 3,
    acceptanceCriteria: [
      'Agent 可使用唯一身份注册并获得项目级角色',
      '所有注册与权限变化均写入可追溯审计日志',
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

export const defects: Defect[] = [
  {
    id: 'defect-104',
    code: 'D-104',
    title: '离线恢复失败',
    severity: 'fatal',
    status: 'open',
    assignee: devAgent,
    updatedAt: '2026-07-28T09:40:00+08:00',
    reproductionSteps: [
      '启动进行中的 MCP 任务',
      '断开网络连接后等待 30 秒',
      '恢复网络并观察任务无法继续',
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
    assignee: chen,
    updatedAt: '2026-07-27T16:20:00+08:00',
    reproductionSteps: ['打开甘特图', '缩小浏览器窗口', '观察长标题被遮挡'],
    linkedTaskId: 'task-063',
  },
]

export const risks: RiskItem[] = [
  {
    id: 'risk-task-047',
    level: 'critical',
    title: '断线恢复阻塞里程碑',
    description: 'TASK-047 已逾期，并阻塞后续甘特图交付。',
    taskId: 'task-047',
    owner: devAgent,
  },
  {
    id: 'risk-task-063',
    level: 'warning',
    title: '甘特图依赖链较长',
    description: '上游恢复测试延误可能压缩 TASK-063 的开发窗口。',
    taskId: 'task-063',
    owner: chen,
  },
]

export const activities: ActivityEvent[] = [
  {
    id: 'activity-001',
    actor: devAgent,
    message: '将「SQLite WAL 支持」更新至 80%',
    operation: 'task.update',
    timestamp: '2026-07-28T10:20:00+08:00',
  },
  {
    id: 'activity-002',
    actor: qaAgent,
    message: '记录缺陷「离线恢复失败」',
    operation: 'defect.create',
    timestamp: '2026-07-28T09:40:00+08:00',
  },
]

export const trendByDays: Record<7 | 30 | 90, TrendPoint[]> = {
  7: [
    { date: '7/22', actual: 5, planned: 6 },
    { date: '7/23', actual: 6, planned: 7 },
    { date: '7/24', actual: 7, planned: 8 },
    { date: '7/25', actual: 8, planned: 9 },
    { date: '7/26', actual: 9, planned: 11 },
    { date: '7/27', actual: 10, planned: 12 },
    { date: '7/28', actual: 11, planned: 13 },
  ],
  30: [
    { date: '6/30', actual: 3, planned: 4 },
    { date: '7/7', actual: 6, planned: 9 },
    { date: '7/14', actual: 11, planned: 15 },
    { date: '7/21', actual: 18, planned: 23 },
    { date: '7/28', actual: 34, planned: 40 },
  ],
  90: [
    { date: '4/30', actual: 24, planned: 22 },
    { date: '5/31', actual: 55, planned: 54 },
    { date: '6/30', actual: 84, planned: 86 },
    { date: '7/14', actual: 101, planned: 102 },
    { date: '7/28', actual: 118, planned: 114 },
  ],
}
