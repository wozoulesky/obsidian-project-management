import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import type {
  Actor,
  Deliverable,
  Handoff,
  Project,
  ProjectMember,
  Task,
} from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { ProjectDetailPage } from './ProjectDetailPage'
import projectDetailSource from './ProjectDetailPage.tsx?raw'

const owner: Actor = {
  id: 'owner-active',
  name: 'Lin',
  kind: 'human',
  role: 'owner',
  status: 'active',
  client: null,
  capabilities: [],
  registeredAt: '2026-07-01T00:00:00.000Z',
  lastActiveAt: null,
  version: 1,
}

const project: Project = {
  id: 'atlas',
  code: 'PRJ-001',
  name: 'Atlas 研发平台',
  description: '统一项目协作入口',
  ownerId: owner.id,
  startDate: '2026-07-01',
  dueDate: '2026-08-31',
  status: 'in_progress',
  progress: 62,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-28T04:00:00.000Z',
  version: 1,
}

const secondProject: Project = {
  ...project,
  id: 'borealis',
  code: 'PRJ-002',
  name: 'Borealis 发布',
}

const membership: ProjectMember = {
  projectId: project.id,
  actorId: owner.id,
  membershipRole: 'owner',
  joinedAt: '2026-07-01T00:00:00.000Z',
}

const inactiveMember: Actor = {
  ...owner,
  id: 'member-inactive',
  name: 'Maya',
  status: 'inactive',
}

const inactiveMembership: ProjectMember = {
  ...membership,
  actorId: inactiveMember.id,
  membershipRole: 'member',
}

const createdTask = {
  id: 'task-new',
  code: 'TASK-001',
  projectId: project.id,
  title: '验证 Claude Code 连接',
  description: '',
  assignee: owner,
  assigneeId: owner.id,
  startDate: '2026-07-29',
  dueDate: '2026-07-30',
  priority: 'P1',
  status: 'not_started',
  progress: 0,
  milestoneId: '',
  dependencyIds: [],
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  version: 1,
} satisfies Task

const handoff: Handoff = {
  id: 'handoff-atlas',
  projectId: project.id,
  sessionId: null,
  author: owner,
  summary: '核心链路已完成，等待发布复核。',
  done: ['完成权限联调'],
  blockers: [],
  nextSteps: ['补齐发布证据'],
  gotchas: [],
  refs: [],
  createdAt: '2026-07-29T02:00:00.000Z',
}

const deliverable: Deliverable = {
  id: 'deliverable-atlas',
  projectId: project.id,
  requirementId: null,
  taskId: createdTask.id,
  title: '权限联调报告',
  kind: 'file',
  ref: 'reports/permissions.md',
  note: '来自真实交付登记',
  createdBy: owner,
  sessionId: null,
  createdAt: '2026-07-29T03:00:00.000Z',
}

afterEach(cleanup)

function mockDetail() {
  vi.spyOn(projectRepository, 'listProjects').mockResolvedValue([
    project,
    secondProject,
  ])
  vi.spyOn(projectRepository, 'getProject').mockResolvedValue(project)
  vi.spyOn(projectRepository, 'listActors').mockResolvedValue([
    owner,
    inactiveMember,
  ])
  vi.spyOn(projectRepository, 'listProjectMembers').mockResolvedValue([
    membership,
    inactiveMembership,
  ])
  vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([])
  vi.spyOn(projectRepository, 'listProjectHandoffs').mockResolvedValue([
    handoff,
  ])
  vi.spyOn(projectRepository, 'listProjectDeliverables').mockResolvedValue([
    deliverable,
  ])
}

function getDeliverableMetric() {
  const metrics = screen.getByRole('group', {
    name: '项目详情关键指标',
  })
  const metric = within(metrics).getByText('交付物').closest('article')
  expect(metric).not.toBeNull()
  return metric!
}

describe('ProjectDetailPage', () => {
  it('loads shared project surface styles from its independent lazy route', () => {
    expect(projectDetailSource).toContain("import './projects-glass.css'")
  })

  it('selects milestones in a continuous track and updates persistent context without routing', async () => {
    const user = userEvent.setup()
    mockDetail()
    vi.mocked(projectRepository.listTasks).mockResolvedValue([
      {
        ...createdTask,
        id: 'milestone-alpha',
        title: 'Alpha 实现',
        milestoneId: 'M-Alpha',
        dueDate: '2026-08-05',
        progress: 45,
        status: 'in_progress',
      },
      {
        ...createdTask,
        id: 'milestone-beta',
        title: 'Beta 验收',
        milestoneId: 'M-Beta',
        dueDate: '2026-08-12',
        progress: 0,
        status: 'not_started',
      },
    ])

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    const track = await screen.findByRole('region', {
      name: '项目里程碑轨迹',
    })
    const alpha = within(track).getByRole('button', {
      name: '查看里程碑 M-Alpha',
    })
    const beta = within(track).getByRole('button', {
      name: '查看里程碑 M-Beta',
    })
    expect(alpha).toHaveAttribute('aria-pressed', 'true')
    expect(beta).toHaveAttribute('aria-pressed', 'false')

    const context = screen.getByRole('region', { name: '里程碑上下文' })
    expect(within(context).getByRole('heading', { name: 'M-Alpha' }))
      .toBeVisible()
    expect(within(context).getByText('2026-08-05')).toBeVisible()
    expect(within(context).getByText('1 项任务')).toBeVisible()
    expect(within(context).getByText(owner.name)).toBeVisible()

    await user.click(beta)

    expect(beta).toHaveAttribute('aria-pressed', 'true')
    expect(within(context).getByRole('heading', { name: 'M-Beta' }))
      .toBeVisible()
    expect(within(context).getByText('2026-08-12')).toBeVisible()
    expect(window.location.pathname).toBe('/projects/atlas')
  })

  it('keeps project brief, open tasks, and delivery evidence in one compact row', async () => {
    mockDetail()
    vi.mocked(projectRepository.listTasks).mockResolvedValue([createdTask])

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    const briefGrid = await screen.findByTestId('project-brief-grid')
    expect(within(briefGrid).getByRole('heading', { name: '项目简报' }))
      .toBeVisible()
    expect(within(briefGrid).getByRole('heading', { name: '开放任务' }))
      .toBeVisible()
    expect(within(briefGrid).getByRole('heading', { name: '交付与交接' }))
      .toBeVisible()
    expect(within(briefGrid).getByText(createdTask.title)).toBeVisible()
    expect(within(briefGrid).getByText(deliverable.title)).toBeVisible()
    expect(within(briefGrid).getByText(handoff.summary)).toBeVisible()
  })

  it('navigates with the real project selector instead of swapping local data', async () => {
    const user = userEvent.setup()
    mockDetail()
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    const selector = await screen.findByRole('combobox', {
      name: '选择项目',
    })
    expect(selector).toHaveValue('atlas')
    expect(screen.getByRole('option', { name: 'Borealis 发布' })).toBeVisible()

    await user.selectOptions(selector, 'borealis')

    expect(window.location.pathname).toBe('/projects/borealis')
  })

  it('shows an explicit milestone empty state and real relay evidence', async () => {
    mockDetail()
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    const track = await screen.findByRole('region', {
      name: '项目里程碑轨迹',
    })
    expect(within(track).getByText('当前任务没有里程碑标识')).toBeVisible()
    const relay = screen.getByRole('region', { name: '交付与交接' })
    expect(within(relay).getByText(deliverable.title)).toBeVisible()
    expect(within(relay).getByText(handoff.summary)).toBeVisible()
  })

  it('marks deliverable evidence as unknown while the first request is pending', async () => {
    mockDetail()
    vi.mocked(projectRepository.listProjectDeliverables).mockImplementation(
      () => new Promise<Deliverable[]>(() => undefined),
    )

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    await screen.findByRole('heading', { level: 1, name: project.name })
    const metric = getDeliverableMetric()
    expect(within(metric).getByText('—')).toBeVisible()
    expect(within(metric).getByText('正在确认交付证据')).toBeVisible()
    expect(within(metric).queryByText('0')).not.toBeInTheDocument()
  })

  it('marks deliverable evidence as unavailable after an initial request error', async () => {
    mockDetail()
    vi.mocked(projectRepository.listProjectDeliverables).mockRejectedValue(
      new Error('交付物服务不可用'),
    )

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    await screen.findByRole('heading', { level: 1, name: project.name })
    const metric = getDeliverableMetric()
    expect(within(metric).getByText('—')).toBeVisible()
    expect(within(metric).getByText('交付证据读取失败')).toBeVisible()
    expect(within(metric).queryByText('0')).not.toBeInTheDocument()
  })

  it('keeps a known deliverable count when a refresh fails', async () => {
    const user = userEvent.setup()
    mockDetail()
    vi.mocked(projectRepository.listProjectDeliverables)
      .mockResolvedValueOnce([deliverable])
      .mockRejectedValueOnce(new Error('交付证据刷新失败'))

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    await screen.findByRole('heading', { level: 1, name: project.name })
    expect(within(getDeliverableMetric()).getByText('1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '刷新项目数据' }))

    expect(
      await screen.findAllByText(/交付证据刷新失败/),
    ).not.toHaveLength(0)
    const metric = getDeliverableMetric()
    expect(within(metric).getByText('1')).toBeVisible()
    expect(within(metric).getByText('已登记证据')).toBeVisible()
  })

  it('derives milestone date, progress and status only from tagged tasks', async () => {
    mockDetail()
    vi.mocked(projectRepository.listTasks).mockResolvedValue([
      {
        ...createdTask,
        id: 'milestone-active',
        title: '里程碑实现',
        milestoneId: 'M-Release',
        dueDate: '2026-08-03',
        progress: 50,
        status: 'in_progress',
      },
      {
        ...createdTask,
        id: 'milestone-done',
        title: '里程碑验收',
        milestoneId: 'M-Release',
        dueDate: '2026-08-05',
        progress: 100,
        status: 'done',
      },
      {
        ...createdTask,
        id: 'untagged',
        title: '无里程碑任务',
        milestoneId: '   ',
        dueDate: '2026-09-01',
        progress: 0,
        status: 'overdue',
      },
    ])
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    const track = await screen.findByRole('region', {
      name: '项目里程碑轨迹',
    })
    expect(within(track).getByRole('heading', { name: 'M-Release' }))
      .toBeVisible()
    expect(within(track).getByText('2 项任务')).toBeVisible()
    expect(within(track).getByText('75%')).toBeVisible()
    expect(within(track).getByText('进行中')).toBeVisible()
    expect(within(track).getByText('2026-08-05')).toBeVisible()
    expect(within(track).queryByText('无里程碑任务')).not.toBeInTheDocument()
  })

  it('creates a task inside the current project only', async () => {
    const user = userEvent.setup()
    mockDetail()
    vi.mocked(projectRepository.listTasks)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdTask])
    const createTask = vi.spyOn(projectRepository, 'createTask')
      .mockResolvedValue(createdTask)

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    await user.click(await screen.findByRole('button', { name: '新建任务' }))
    expect(screen.getByText('在 Atlas 研发平台 中创建任务')).toBeVisible()
    expect(screen.queryByLabelText('所属项目')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('任务标题'), createdTask.title)
    await user.selectOptions(screen.getByLabelText('负责人'), owner.id)
    await user.type(screen.getByLabelText('开始日期'), createdTask.startDate)
    await user.type(screen.getByLabelText('截止日期'), createdTask.dueDate)
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(createTask).toHaveBeenCalledWith(project.id, {
      title: createdTask.title,
      description: '',
      assigneeId: owner.id,
      startDate: createdTask.startDate,
      dueDate: createdTask.dueDate,
      priority: 'P1',
    })
    expect(await screen.findByText(createdTask.title)).toBeVisible()
  })

  it('shows project overview and limits assignees to active project members', async () => {
    const user = userEvent.setup()
    mockDetail()
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    expect(await screen.findByRole('heading', {
      level: 1,
      name: project.name,
    })).toBeVisible()
    expect(screen.getByText(project.description)).toBeVisible()
    expect(screen.getByText('进行中')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveValue(62)
    expect(screen.getByText('排期正常')).toBeVisible()
    expect(screen.getByText(inactiveMember.name)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '新建任务' }))
    const assignee = screen.getByLabelText('负责人')
    expect(assignee).toHaveDisplayValue('请选择')
    expect(screen.getByRole('option', { name: owner.name })).toBeVisible()
    expect(
      screen.queryByRole('option', { name: inactiveMember.name }),
    ).not.toBeInTheDocument()
  })

  it('validates dates and preserves entered values and API errors', async () => {
    const user = userEvent.setup()
    mockDetail()
    vi.spyOn(projectRepository, 'createTask').mockRejectedValue(
      new Error('任务服务不可用'),
    )
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    await user.click(await screen.findByRole('button', { name: '新建任务' }))
    const dialog = screen.getByRole('dialog')
    await user.type(screen.getByLabelText('任务标题'), '保留任务')
    await user.selectOptions(screen.getByLabelText('负责人'), owner.id)
    await user.type(screen.getByLabelText('开始日期'), '2026-08-10')
    await user.type(screen.getByLabelText('截止日期'), '2026-08-01')
    await user.click(screen.getByRole('button', { name: '创建任务' }))
    expect(screen.getByText('开始日期不能晚于截止日期')).toBeVisible()

    await user.clear(screen.getByLabelText('截止日期'))
    await user.type(screen.getByLabelText('截止日期'), '2026-08-20')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('任务服务不可用')
    expect(dialog).toBeVisible()
    expect(screen.getByLabelText('任务标题')).toHaveValue('保留任务')
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-08-10')
  })

  it('traps focus, closes on Escape, and restores focus to its opener', async () => {
    const user = userEvent.setup()
    mockDetail()
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })
    const opener = await screen.findByRole('button', { name: '新建任务' })

    await user.click(opener)
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: '关闭新建任务' })
    const submit = screen.getByRole('button', { name: '创建任务' })
    close.focus()
    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(dialog).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('shows an initial dependency error instead of partial project data', async () => {
    vi.spyOn(projectRepository, 'getProject').mockResolvedValue(project)
    vi.spyOn(projectRepository, 'listActors').mockRejectedValue(
      new Error('成员服务不可用'),
    )
    vi.spyOn(projectRepository, 'listProjectMembers').mockResolvedValue([
      membership,
    ])
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([])

    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    expect(await screen.findByRole('alert')).toHaveTextContent('成员服务不可用')
    expect(
      screen.queryByRole('heading', { level: 1, name: project.name }),
    ).not.toBeInTheDocument()
  })

  it('keeps stale detail visible when a post-create refetch fails', async () => {
    const user = userEvent.setup()
    mockDetail()
    vi.mocked(projectRepository.getProject)
      .mockResolvedValueOnce(project)
      .mockRejectedValueOnce(new Error('项目详情刷新失败'))
    vi.spyOn(projectRepository, 'createTask').mockResolvedValue(createdTask)
    vi.mocked(projectRepository.listTasks)
      .mockResolvedValueOnce([])
      .mockResolvedValue([createdTask])
    renderApp(<ProjectDetailPage />, { route: '/projects/atlas' })

    await user.click(await screen.findByRole('button', { name: '新建任务' }))
    await user.type(screen.getByLabelText('任务标题'), createdTask.title)
    await user.selectOptions(screen.getByLabelText('负责人'), owner.id)
    await user.type(screen.getByLabelText('开始日期'), createdTask.startDate)
    await user.type(screen.getByLabelText('截止日期'), createdTask.dueDate)
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '项目详情刷新失败',
    )
    expect(screen.getByRole('heading', {
      level: 1,
      name: project.name,
    })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
