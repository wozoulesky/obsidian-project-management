import type { DragEndEvent } from '@dnd-kit/core'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import type { Task, TaskStatus } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { TaskPage } from './TaskPage'
import {
  createTaskBoardDragEndHandler,
  statusFromDrop,
  TaskBoard,
} from './TaskBoard'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-alpha',
    code: 'TASK-ALPHA',
    title: '接口联调',
    description: '联调项目接口',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-08-01',
    dueDate: '2026-08-08',
    priority: 'P0',
    status: 'in_progress',
    progress: 62,
    milestoneId: 'm1',
    dependencyIds: [],
    projectId: 'atlas',
    version: 4,
    ...overrides,
  }
}

const fixtureTasks = [
  task(),
  task({
    id: 'task-beta',
    code: 'TASK-BETA',
    title: '发布检查',
    assignee: { id: 'agent-qa', name: 'QA Agent', kind: 'agent' },
    dueDate: '2026-08-10',
    priority: 'P2',
    status: 'not_started',
    progress: 0,
  }),
  task({
    id: 'task-done',
    code: 'TASK-DONE',
    title: '需求梳理',
    status: 'done',
    progress: 100,
  }),
  task({
    id: 'task-overdue',
    code: 'TASK-OVERDUE',
    title: '风险复盘',
    status: 'overdue',
    progress: 35,
  }),
]

function renderBoard({
  onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
    .mockResolvedValue(undefined),
  onSelect = vi.fn(),
  selectedTaskId = null,
  tasks = fixtureTasks,
}: {
  onMoveTask?: (task: Task, status: TaskStatus) => Promise<void>
  onSelect?: (taskId: string) => void
  selectedTaskId?: string | null
  tasks?: readonly Task[]
} = {}) {
  return {
    onMoveTask,
    onSelect,
    ...render(
      <TaskBoard
        onMoveTask={onMoveTask}
        onSelect={onSelect}
        selectedTaskId={selectedTaskId}
        tasks={tasks}
      />,
    ),
  }
}

describe('TaskBoard', () => {
  it('renders four status columns and real task fields', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderBoard({ selectedTaskId: 'task-alpha' })

    for (const label of ['未开始', '进行中', '已完成', '已逾期']) {
      expect(screen.getByRole('region', { name: new RegExp(label) }))
        .toBeVisible()
    }

    const alpha = screen.getByTestId('task-board-card-task-alpha')
    expect(alpha).toHaveTextContent('TASK-ALPHA')
    expect(alpha).toHaveTextContent('接口联调')
    expect(alpha).toHaveTextContent('62%')
    expect(alpha).toHaveTextContent('Lin')
    expect(alpha).toHaveTextContent('P0')
    expect(alpha).toHaveTextContent('2026-08-08')
    expect(within(alpha).getByRole('button', { name: /选择 .*接口联调/ }))
      .toHaveAttribute('aria-pressed', 'true')

    await user.click(within(alpha).getByRole('button', {
      name: /选择 .*接口联调/,
    }))
    expect(onSelect).toHaveBeenCalledWith('task-alpha')
  })

  it('keeps every empty column droppable and labels its empty state', () => {
    renderBoard({ tasks: [] })

    for (const label of ['未开始', '进行中', '已完成', '已逾期']) {
      const column = screen.getByRole('region', {
        name: new RegExp(label),
      })
      expect(column).toHaveAttribute('data-status')
      expect(within(column).getByText('0')).toBeVisible()
      expect(within(column).getByText('暂无任务')).toBeVisible()
    }
  })

  it('moves a task through the keyboard fallback and announces success', async () => {
    const user = userEvent.setup()
    const { onMoveTask } = renderBoard()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '移动 接口联调 到' }),
      'done',
    )

    await waitFor(() => expect(onMoveTask).toHaveBeenCalledWith(
      fixtureTasks[0],
      'done',
    ))
    expect(screen.getByText('已将 接口联调 移动到已完成')
      .closest('[role="status"]'))
      .toHaveClass('task-board__announcement')
  })

  it('announces a failed move and suppresses the rejected promise', async () => {
    const user = userEvent.setup()
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockRejectedValue(new Error('conflict'))
    renderBoard({ onMoveTask })

    await user.selectOptions(
      screen.getByRole('combobox', { name: '移动 接口联调 到' }),
      'done',
    )

    expect((await screen.findByText(
      '移动 接口联调 失败，任务已恢复到原状态',
    )).closest('[role="status"]'))
      .toHaveClass('task-board__announcement')
  })

  it('announces concurrent task results in settlement order', async () => {
    let resolveAlpha!: () => void
    let resolveBeta!: () => void
    const alphaMove = new Promise<void>((resolve) => {
      resolveAlpha = resolve
    })
    const betaMove = new Promise<void>((resolve) => {
      resolveBeta = resolve
    })
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockImplementation((selectedTask) => (
        selectedTask.id === 'task-alpha' ? alphaMove : betaMove
      ))
    const user = userEvent.setup()
    renderBoard({ onMoveTask })

    await user.selectOptions(
      screen.getByRole('combobox', { name: '移动 接口联调 到' }),
      'done',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '移动 发布检查 到' }),
      'done',
    )

    resolveBeta()
    const firstMessage = await screen.findByText(
      '已将 发布检查 移动到已完成',
    )
    const firstId = firstMessage.getAttribute('data-announcement-id')

    resolveAlpha()
    const secondMessage = await screen.findByText(
      '已将 接口联调 移动到已完成',
    )
    expect(secondMessage).not.toBe(firstMessage)
    expect(secondMessage.getAttribute('data-announcement-id')).not.toBe(firstId)
    expect(document.querySelectorAll('.task-board__announcement'))
      .toHaveLength(1)
  })

  it('keeps both failure announcements when two moves settle in one batch', async () => {
    let rejectAlpha!: (reason: Error) => void
    let rejectBeta!: (reason: Error) => void
    const alphaMove = new Promise<void>((_resolve, reject) => {
      rejectAlpha = reject
    })
    const betaMove = new Promise<void>((_resolve, reject) => {
      rejectBeta = reject
    })
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockImplementation((selectedTask) => (
        selectedTask.id === 'task-alpha' ? alphaMove : betaMove
      ))
    const { container } = renderBoard({ onMoveTask })

    act(() => {
      fireEvent.change(
        screen.getByRole('combobox', { name: '移动 接口联调 到' }),
        { target: { value: 'done' } },
      )
      fireEvent.change(
        screen.getByRole('combobox', { name: '移动 发布检查 到' }),
        { target: { value: 'done' } },
      )
    })

    await act(async () => {
      rejectAlpha(new Error('alpha conflict'))
      rejectBeta(new Error('beta conflict'))
      await Promise.allSettled([alphaMove, betaMove])
    })

    const liveRegion = container.querySelector('.task-board__announcement')!
    const messages = liveRegion.querySelectorAll('[data-announcement-id]')
    expect(container.querySelectorAll('.task-board__announcement'))
      .toHaveLength(1)
    expect(messages).toHaveLength(2)
    expect(new Set(Array.from(messages, (message) => (
      message.getAttribute('data-announcement-id')
    ))).size).toBe(2)
    expect(messages[0]).toHaveTextContent('接口联调')
    expect(messages[1]).toHaveTextContent('发布检查')
  })

  it('keeps success and failure announcements when two moves settle in one batch', async () => {
    let resolveAlpha!: () => void
    let rejectBeta!: (reason: Error) => void
    const alphaMove = new Promise<void>((resolve) => {
      resolveAlpha = resolve
    })
    const betaMove = new Promise<void>((_resolve, reject) => {
      rejectBeta = reject
    })
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockImplementation((selectedTask) => (
        selectedTask.id === 'task-alpha' ? alphaMove : betaMove
      ))
    const { container } = renderBoard({ onMoveTask })

    act(() => {
      fireEvent.change(
        screen.getByRole('combobox', { name: '移动 接口联调 到' }),
        { target: { value: 'done' } },
      )
      fireEvent.change(
        screen.getByRole('combobox', { name: '移动 发布检查 到' }),
        { target: { value: 'done' } },
      )
    })

    await act(async () => {
      resolveAlpha()
      rejectBeta(new Error('beta conflict'))
      await Promise.allSettled([alphaMove, betaMove])
    })

    const liveRegion = container.querySelector('.task-board__announcement')!
    const messages = liveRegion.querySelectorAll('[data-announcement-id]')
    expect(container.querySelectorAll('.task-board__announcement'))
      .toHaveLength(1)
    expect(messages).toHaveLength(2)
    expect(new Set(Array.from(messages, (message) => (
      message.getAttribute('data-announcement-id')
    ))).size).toBe(2)
    expect(messages[0]).toHaveTextContent('接口联调')
    expect(messages[0]).toHaveTextContent('已完成')
    expect(messages[1]).toHaveTextContent('发布检查')
    expect(messages[1]).toHaveTextContent('失败')
  })

  it('appends a unique live message node for consecutive identical failures', async () => {
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockRejectedValue(new Error('conflict'))
    const user = userEvent.setup()
    renderBoard({ onMoveTask })
    const moveControl = screen.getByRole('combobox', {
      name: '移动 接口联调 到',
    })

    await user.selectOptions(moveControl, 'done')
    const firstMessage = await screen.findByText(
      '移动 接口联调 失败，任务已恢复到原状态',
    )
    const firstId = firstMessage.getAttribute('data-announcement-id')
    await waitFor(() => expect(moveControl).toBeEnabled())

    await user.selectOptions(moveControl, 'overdue')
    await waitFor(() => expect(onMoveTask).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const messages = screen.getAllByText(
        '移动 接口联调 失败，任务已恢复到原状态',
      )
      expect(messages).toHaveLength(2)
      const secondMessage = messages[1]!
      expect(secondMessage).not.toBe(firstMessage)
      expect(secondMessage.getAttribute('data-announcement-id'))
        .not.toBe(firstId)
    })
  })

  it('keeps only the twelve most recent live announcements', async () => {
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockRejectedValue(new Error('conflict'))
    const { container } = renderBoard({ onMoveTask })
    const moveControl = screen.getByRole('combobox', {
      name: '移动 接口联调 到',
    })

    for (let index = 1; index <= 13; index += 1) {
      fireEvent.change(moveControl, {
        target: { value: index % 2 === 0 ? 'overdue' : 'done' },
      })
      await waitFor(() => expect(onMoveTask).toHaveBeenCalledTimes(index))
      await waitFor(() => expect(moveControl).toBeEnabled())
    }

    const messages = container.querySelectorAll('[data-announcement-id]')
    expect(messages).toHaveLength(12)
    expect(messages[0]).toHaveAttribute('data-announcement-id', '2')
    expect(messages[11]).toHaveAttribute('data-announcement-id', '13')
  })

  it('disables movement controls only for the pending task', async () => {
    let resolveMove!: () => void
    const pendingMove = new Promise<void>((resolve) => {
      resolveMove = resolve
    })
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockReturnValueOnce(pendingMove)
      .mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderBoard({ onMoveTask })

    await user.selectOptions(
      screen.getByRole('combobox', { name: '移动 接口联调 到' }),
      'done',
    )

    expect(screen.getByRole('combobox', { name: '移动 接口联调 到' }))
      .toBeDisabled()
    expect(screen.getByRole('button', { name: '拖拽 接口联调' }))
      .toBeDisabled()
    expect(screen.getByRole('combobox', { name: '移动 发布检查 到' }))
      .toBeEnabled()
    expect(screen.getByRole('button', { name: '拖拽 发布检查' }))
      .toBeEnabled()

    resolveMove()
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '移动 接口联调 到' }))
        .toBeEnabled()
    })
  })

  it('deduplicates same-task moves synchronously and keeps the owner pending', async () => {
    let resolveMove!: () => void
    const pendingMove = new Promise<void>((resolve) => {
      resolveMove = resolve
    })
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockReturnValue(pendingMove)
    renderBoard({ onMoveTask })
    const moveControl = screen.getByRole('combobox', {
      name: '移动 接口联调 到',
    })

    act(() => {
      fireEvent.change(moveControl, { target: { value: 'done' } })
      fireEvent.change(moveControl, { target: { value: 'overdue' } })
    })

    expect(onMoveTask).toHaveBeenCalledTimes(1)
    expect(moveControl).toBeDisabled()
    resolveMove()
    await waitFor(() => expect(moveControl).toBeEnabled())
  })
})

describe('task board drag handling', () => {
  it.each([
    ['column:not_started', 'not_started'],
    ['column:in_progress', 'in_progress'],
    ['column:done', 'done'],
    ['column:overdue', 'overdue'],
  ] as const)('maps %s to %s', (overId, expected) => {
    expect(statusFromDrop(overId)).toBe(expected)
  })

  it.each(['task:task-alpha', 'column:unknown', 'done', '', null, undefined])(
    'rejects invalid drop target %s',
    (overId) => {
      expect(statusFromDrop(overId)).toBeNull()
    },
  )

  it('moves through the shared drag-end handler only for a new column', async () => {
    const onMoveTask = vi.fn<(task: Task, status: TaskStatus) => Promise<void>>()
      .mockResolvedValue(undefined)
    const handleDragEnd = createTaskBoardDragEndHandler(onMoveTask)
    const activeTask = fixtureTasks[0]!

    await handleDragEnd({
      active: { data: { current: { task: activeTask } } },
      over: { id: 'column:done' },
    } as unknown as DragEndEvent)
    await handleDragEnd({
      active: { data: { current: { task: activeTask } } },
      over: { id: 'column:in_progress' },
    } as unknown as DragEndEvent)
    await handleDragEnd({
      active: { data: { current: { task: activeTask } } },
      over: { id: 'task:task-done' },
    } as unknown as DragEndEvent)

    expect(onMoveTask).toHaveBeenCalledTimes(1)
    expect(onMoveTask).toHaveBeenCalledWith(activeTask, 'done')
  })
})

describe('TaskPage board integration', () => {
  it('mounts the board from URL state and keeps shared selection/context', async () => {
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue(fixtureTasks)
    renderApp(<TaskPage />, {
      route: '/tasks?view=board&selected=task-beta',
    })

    const board = await screen.findByRole('region', { name: '任务看板工作区' })
    expect(board).toBeVisible()
    expect(within(board).getByRole('button', { name: /选择 .*发布检查/ }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('发布检查')
    expect(screen.queryByText('任务看板将在下一阶段接入。'))
      .not.toBeInTheDocument()
  })

  it('moves through the repository with the task project and version', async () => {
    const explicitProjectTask = task({
      id: 'task-explicit-project',
      title: '跨项目任务',
      projectId: 'borealis',
      version: 11,
    })
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      explicitProjectTask,
    ])
    const updateTaskProgress = vi.spyOn(
      projectRepository,
      'updateTaskProgress',
    ).mockResolvedValue({
      ...explicitProjectTask,
      status: 'done',
      progress: 100,
      version: 12,
    })
    const user = userEvent.setup()
    renderApp(<TaskPage />, { route: '/tasks?view=board' })

    await user.selectOptions(
      await screen.findByRole('combobox', { name: '移动 跨项目任务 到' }),
      'done',
    )

    await waitFor(() => expect(updateTaskProgress).toHaveBeenCalledWith(
      'task-explicit-project',
      expect.objectContaining({
        progress: 100,
        status: 'done',
        version: 11,
      }),
    ))
    expect(await screen.findByText('已将 跨项目任务 移动到已完成'))
      .toBeVisible()
  })

  it('falls back to the workspace project for a task without projectId', async () => {
    const fallbackTask = task({
      id: 'task-workspace-fallback',
      title: '工作区回退任务',
      projectId: undefined,
      version: 7,
    })
    const updatedTask = {
      ...fallbackTask,
      projectId: 'atlas',
      status: 'done' as const,
      progress: 100,
      version: 8,
    }
    const listTasks = vi.spyOn(projectRepository, 'listTasks')
      .mockResolvedValueOnce([fallbackTask])
      .mockResolvedValue([updatedTask])
    const updateTaskProgress = vi.spyOn(
      projectRepository,
      'updateTaskProgress',
    ).mockResolvedValue(updatedTask)
    const user = userEvent.setup()
    renderApp(<TaskPage />, { route: '/tasks?view=board' })

    await user.selectOptions(
      await screen.findByRole('combobox', {
        name: '移动 工作区回退任务 到',
      }),
      'done',
    )

    await waitFor(() => expect(updateTaskProgress).toHaveBeenCalledWith(
      'task-workspace-fallback',
      expect.objectContaining({
        progress: 100,
        status: 'done',
        version: 7,
      }),
    ))
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2))
    expect(listTasks).toHaveBeenNthCalledWith(1, 'atlas')
    expect(listTasks).toHaveBeenNthCalledWith(2, 'atlas')
  })
})
