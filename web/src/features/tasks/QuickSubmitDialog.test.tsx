import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import { AppShell } from '../../components/app-shell/AppShell'
import type { Actor, Task } from '../../data/domain'
import {
  ProjectRepositoryProvider,
  projectQueryKeys,
  projectRepository,
} from '../../data/query-hooks'

const actors: Actor[] = [
  {
    id: 'dev-agent-id',
    name: 'dev-agent',
    kind: 'agent',
    role: 'dev-agent',
    status: 'active',
    client: 'codex',
    capabilities: [],
    registeredAt: '2026-07-01T00:00:00.000Z',
    lastActiveAt: '2026-07-29T00:00:00.000Z',
    version: 1,
  },
]

const tasks: Task[] = [
  {
    id: 'task-mcp',
    code: 'TASK-051',
    projectId: 'project-borealis',
    title: 'MCP 权限校验',
    description: '',
    assignee: actors[0]!,
    assigneeId: actors[0]!.id,
    startDate: '2026-07-24',
    dueDate: '2026-07-28',
    priority: 'P0',
    status: 'in_progress',
    progress: 62,
    milestoneId: 'm2',
    dependencyIds: [],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    version: 7,
  },
]

afterEach(cleanup)

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectRepositoryProvider
        repository={projectRepository}
        projectId="atlas"
      >
        <BrowserRouter>{ui}</BrowserRouter>
      </ProjectRepositoryProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('QuickSubmitDialog', () => {
  it('opens from the header, filters tasks by actor, and persists progress', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue(tasks)
    const updateProgress = vi
      .spyOn(projectRepository, 'updateTaskProgress')
      .mockResolvedValue({ ...tasks[0]!, progress: 80 })

    renderApp(<AppShell><div /></AppShell>)

    const trigger = screen.getByRole('button', { name: '快速提交' })
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: '快速提交' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    await user.selectOptions(screen.getByLabelText('负责人'), 'dev-agent-id')
    expect(
      await screen.findByRole('option', { name: 'MCP 权限校验' }),
    ).toBeVisible()
    await user.selectOptions(screen.getByLabelText('任务'), 'task-mcp')
    expect(screen.getByLabelText('进度')).toHaveValue(62)
    expect(screen.getByLabelText('状态')).toHaveValue('in_progress')

    await user.clear(screen.getByLabelText('进度'))
    await user.type(screen.getByLabelText('进度'), '80')
    await user.click(screen.getByRole('button', { name: '提交进度' }))

    expect(updateProgress).toHaveBeenCalledWith('task-mcp', {
      progress: 80,
      status: 'in_progress',
      note: '',
      version: 7,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('已更新至 80%')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('moves focus into the modal and focuses the first invalid field', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue(tasks)
    vi.spyOn(projectRepository, 'updateTaskProgress')

    renderApp(<AppShell />)
    await user.click(screen.getByRole('button', { name: '快速提交' }))

    const actorSelect = await screen.findByRole('combobox', {
      name: '负责人',
    })
    expect(actorSelect).toHaveFocus()
    await user.selectOptions(actorSelect, 'dev-agent-id')
    await user.selectOptions(screen.getByLabelText('任务'), 'task-mcp')
    await user.clear(screen.getByLabelText('进度'))
    await user.type(screen.getByLabelText('进度'), '10.5')
    await user.click(screen.getByRole('button', { name: '提交进度' }))

    expect(screen.getByText('进度必须是 0 到 100 的整数。')).toBeVisible()
    expect(screen.getByLabelText('进度')).toHaveFocus()
    expect(projectRepository.updateTaskProgress).not.toHaveBeenCalled()
  })

  it('keeps entered values and the API error after a failed submission', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue(tasks)
    vi.spyOn(projectRepository, 'updateTaskProgress').mockRejectedValue(
      new Error('任务版本冲突'),
    )

    renderApp(<AppShell />)
    await user.click(screen.getByRole('button', { name: '快速提交' }))
    await user.selectOptions(
      await screen.findByRole('combobox', { name: '负责人' }),
      'dev-agent-id',
    )
    await user.selectOptions(screen.getByLabelText('任务'), 'task-mcp')
    await user.clear(screen.getByLabelText('进度'))
    await user.type(screen.getByLabelText('进度'), '80')
    await user.type(screen.getByLabelText('进度备注'), '保持这条备注')
    await user.click(screen.getByRole('button', { name: '提交进度' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('任务版本冲突')
    expect(screen.getByLabelText('进度')).toHaveValue(80)
    expect(screen.getByLabelText('进度备注')).toHaveValue('保持这条备注')
    expect(screen.getByRole('dialog', { name: '快速提交' })).toBeVisible()
  })

  it('freezes task version and project at selection time', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue(tasks)
    const updateProgress = vi
      .spyOn(projectRepository, 'updateTaskProgress')
      .mockResolvedValue(tasks[0]!)
    const queryClient = renderWithQueryClient(<AppShell />)
    queryClient.setQueryData(
      projectQueryKeys.tasksFor('project-borealis'),
      { seeded: true },
    )
    queryClient.setQueryData(
      projectQueryKeys.tasksFor('project-refetched'),
      { seeded: true },
    )

    await user.click(screen.getByRole('button', { name: '快速提交' }))
    await user.selectOptions(
      await screen.findByRole('combobox', { name: '负责人' }),
      'dev-agent-id',
    )
    await user.selectOptions(screen.getByLabelText('任务'), 'task-mcp')

    act(() => {
      queryClient.setQueryData(projectQueryKeys.allTasks, [
        {
          ...tasks[0]!,
          projectId: 'project-refetched',
          version: 8,
        },
      ])
    })
    await user.click(screen.getByRole('button', { name: '提交进度' }))

    expect(updateProgress).toHaveBeenCalledWith('task-mcp', {
      progress: 62,
      status: 'in_progress',
      note: '',
      version: 7,
    })
    expect(
      queryClient.getQueryState(
        projectQueryKeys.tasksFor('project-borealis'),
      )?.isInvalidated,
    ).toBe(true)
    expect(
      queryClient.getQueryState(
        projectQueryKeys.tasksFor('project-refetched'),
      )?.isInvalidated,
    ).toBe(false)
  })
})
