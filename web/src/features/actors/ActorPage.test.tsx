import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import type { Actor, Project, Task } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { ActorPage } from './ActorPage'

afterEach(() => {
  cleanup()
})

const actors = [
  {
    id: 'human-lin',
    name: 'Lin',
    kind: 'human',
    role: 'owner',
    status: 'active',
    client: null,
    capabilities: ['planning'],
    registeredAt: '2026-07-01T00:00:00.000Z',
    lastActiveAt: '2026-07-29T02:00:00.000Z',
    version: 3,
  },
  {
    id: 'dev-agent-7f3a',
    name: 'dev-agent',
    kind: 'agent',
    role: 'dev-agent',
    status: 'active',
    client: 'Codex',
    capabilities: ['delivery'],
    registeredAt: '2026-07-02T00:00:00.000Z',
    lastActiveAt: '2026-07-29T03:00:00.000Z',
    version: 5,
  },
] satisfies Actor[]

const projects: Project[] = [
  {
    id: 'atlas',
    code: 'ATLAS',
    name: 'Atlas',
    description: '',
    ownerId: 'dev-agent-7f3a',
    startDate: '2026-07-01',
    dueDate: '2026-08-31',
    status: 'in_progress',
    progress: 62,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    version: 1,
  },
]

const tasks: Task[] = [
  {
    id: 'task-1',
    code: 'TASK-001',
    projectId: 'atlas',
    title: 'MCP 权限校验',
    description: '',
    assignee: actors[1]!,
    assigneeId: 'dev-agent-7f3a',
    startDate: '2026-07-28',
    dueDate: '2026-07-30',
    priority: 'P1',
    status: 'in_progress',
    progress: 50,
    milestoneId: '',
    dependencyIds: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    version: 1,
  },
]

function arrangeDirectory() {
  vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
  vi.spyOn(projectRepository, 'listProjects').mockResolvedValue(projects)
  vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue(tasks)
}

describe('ActorPage', () => {
  it('shows humans and agents with operational context', async () => {
    arrangeDirectory()

    renderApp(<ActorPage />)

    const row = await screen.findByRole('row', { name: /dev-agent/ })
    expect(within(row).getByText('Agent')).toBeVisible()
    expect(within(row).getByText('Codex')).toBeVisible()
    expect(within(row).getByText('1 个项目')).toBeVisible()
    expect(within(row).getByText('1 个任务')).toBeVisible()
    expect(within(row).getByText(/最近活动/)).toBeVisible()
    expect(screen.getByText(/Agent 通过 MCP 注册/)).toBeVisible()
  })

  it('opens a human-only create form', async () => {
    arrangeDirectory()
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    await user.click(await screen.findByRole('button', { name: '新增负责人' }))

    expect(screen.getByRole('dialog', { name: '新增负责人' })).toBeVisible()
    expect(screen.getByRole('option', { name: '人类成员' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Agent' }))
      .not.toBeInTheDocument()
    expect(screen.getByLabelText('姓名')).toBeRequired()
  })

  it('creates a human with the real repository mutation', async () => {
    arrangeDirectory()
    const createHuman = vi.spyOn(projectRepository, 'createHuman')
      .mockResolvedValue({
        id: 'human-ming',
        name: 'Ming',
        kind: 'human',
        role: 'member',
        status: 'active',
        client: null,
        capabilities: ['research', 'writing'],
        registeredAt: '2026-07-29T00:00:00.000Z',
        lastActiveAt: null,
        version: 1,
      })
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    await user.click(await screen.findByRole('button', { name: '新增负责人' }))
    await user.type(screen.getByLabelText('姓名'), 'Ming')
    await user.selectOptions(screen.getByLabelText('人类角色'), 'member')
    await user.type(screen.getByLabelText('能力'), 'research, writing')
    await user.click(screen.getByRole('button', { name: '创建负责人' }))

    expect(createHuman).toHaveBeenCalledWith({
      name: 'Ming',
      role: 'member',
      capabilities: ['research', 'writing'],
    })
    expect(screen.queryByRole('dialog', { name: '新增负责人' }))
      .not.toBeInTheDocument()
  })

  it('edits a human with the row version and preserves values on failure', async () => {
    arrangeDirectory()
    const updateActor = vi.spyOn(projectRepository, 'updateActor')
      .mockRejectedValue(new Error('负责人已被其他人更新'))
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    const row = await screen.findByRole('row', { name: /Lin/ })
    await user.click(within(row).getByRole('button', { name: '编辑 Lin' }))
    const name = screen.getByLabelText('姓名')
    await user.clear(name)
    await user.type(name, 'Lin Q.')
    await user.click(screen.getByRole('button', { name: '保存负责人' }))

    expect(updateActor).toHaveBeenCalledWith('human-lin', {
      name: 'Lin Q.',
      role: 'owner',
      capabilities: ['planning'],
      version: 3,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '负责人已被其他人更新',
    )
    expect(name).toHaveValue('Lin Q.')
    expect(screen.getByRole('dialog', { name: '编辑负责人' })).toBeVisible()
  })

  it('requires explicit confirmation and keeps a failed deactivation open', async () => {
    arrangeDirectory()
    const deactivateActor = vi.spyOn(projectRepository, 'deactivateActor')
      .mockRejectedValue(new Error('版本冲突，请刷新后重试'))
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    const row = await screen.findByRole('row', { name: /Lin/ })
    await user.click(
      within(row).getByRole('button', { name: '停用 Lin' }),
    )
    const dialog = screen.getByRole('dialog', { name: '确认停用 Lin' })
    expect(dialog).toHaveTextContent('停用后将不能再被分配')
    await user.click(
      within(dialog).getByRole('button', { name: '确认停用' }),
    )

    expect(deactivateActor).toHaveBeenCalledWith('human-lin', 3)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '版本冲突，请刷新后重试',
    )
    expect(dialog).toBeVisible()
  })

  it('copies an Agent ID and announces the result', async () => {
    arrangeDirectory()
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    renderApp(<ActorPage />)
    const row = await screen.findByRole('row', { name: /dev-agent/ })
    await user.click(
      within(row).getByRole('button', { name: '复制 dev-agent 的 Agent ID' }),
    )

    expect(writeText).toHaveBeenCalledWith('dev-agent-7f3a')
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已复制 dev-agent 的 Agent ID',
    )
  })

  it('deactivates an active Agent with its row version', async () => {
    arrangeDirectory()
    const deactivateActor = vi.spyOn(projectRepository, 'deactivateActor')
      .mockResolvedValue({
        ...actors[1]!,
        status: 'inactive',
        version: 6,
      })
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    const row = await screen.findByRole('row', { name: /dev-agent/ })
    expect(within(row).queryByRole('button', { name: '编辑 dev-agent' }))
      .not.toBeInTheDocument()
    await user.click(
      within(row).getByRole('button', { name: '停用 dev-agent' }),
    )
    const dialog = screen.getByRole('dialog', { name: '确认停用 dev-agent' })
    await user.click(
      within(dialog).getByRole('button', { name: '确认停用' }),
    )

    expect(deactivateActor).toHaveBeenCalledWith('dev-agent-7f3a', 5)
  })

  it('marks inactive actors as unavailable and disables lifecycle actions', async () => {
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue([
      {
        ...actors[0]!,
        name: 'Inactive Lin',
        status: 'inactive',
      },
      {
        ...actors[1]!,
        name: 'Inactive Agent',
        status: 'inactive',
      },
    ])
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue([])
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue([])

    renderApp(<ActorPage />)

    const row = await screen.findByRole('row', { name: /Inactive Lin/ })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(within(row).getByText('已停用')).toBeVisible()
    expect(within(row).getByRole('button', { name: '编辑 Inactive Lin' }))
      .toBeDisabled()
    expect(within(row).getByRole('button', { name: '停用 Inactive Lin' }))
      .toBeDisabled()

    const agentRow = screen.getByRole('row', { name: /Inactive Agent/ })
    expect(agentRow).toHaveAttribute('aria-disabled', 'true')
    expect(within(agentRow).getByRole('button', {
      name: '停用 Inactive Agent',
    })).toBeDisabled()
  })

  it('closes the form with Escape and restores focus to its opener', async () => {
    arrangeDirectory()
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    const opener = await screen.findByRole('button', { name: '新增负责人' })
    await user.click(opener)
    expect(screen.getByLabelText('姓名')).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '新增负责人' }))
      .not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('shows initial mixed-query errors without rendering partial rows', async () => {
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
    vi.spyOn(projectRepository, 'listProjects').mockRejectedValue(
      new Error('项目统计不可用'),
    )
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue(tasks)

    renderApp(<ActorPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('项目统计不可用')
    expect(screen.queryByRole('table', { name: '负责人目录' }))
      .not.toBeInTheDocument()
  })

  it('keeps stale directory rows visible when a refetch fails', async () => {
    arrangeDirectory()
    vi.mocked(projectRepository.listActors)
      .mockResolvedValueOnce(actors)
      .mockRejectedValueOnce(new Error('负责人刷新失败'))
    vi.spyOn(projectRepository, 'createHuman').mockResolvedValue({
      ...actors[0]!,
      id: 'human-ming',
      name: 'Ming',
      version: 1,
    })
    const user = userEvent.setup()

    renderApp(<ActorPage />)
    expect(await screen.findByRole('row', { name: /dev-agent/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '新增负责人' }))
    await user.type(screen.getByLabelText('姓名'), 'Ming')
    await user.click(screen.getByRole('button', { name: '创建负责人' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('负责人刷新失败')
    expect(screen.getByRole('row', { name: /dev-agent/ })).toBeVisible()
  })
})
