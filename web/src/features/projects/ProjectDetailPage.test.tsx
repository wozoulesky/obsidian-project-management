import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import type { Actor, Project, ProjectMember, Task } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { ProjectDetailPage } from './ProjectDetailPage'

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

afterEach(cleanup)

function mockDetail() {
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
}

describe('ProjectDetailPage', () => {
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
