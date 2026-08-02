import type { DragEndEvent } from '@dnd-kit/core'
import { render, screen, waitFor, within } from '@testing-library/react'
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
}: {
  onMoveTask?: (task: Task, status: TaskStatus) => Promise<void>
  onSelect?: (taskId: string) => void
  selectedTaskId?: string | null
} = {}) {
  return {
    onMoveTask,
    onSelect,
    ...render(
      <TaskBoard
        onMoveTask={onMoveTask}
        onSelect={onSelect}
        selectedTaskId={selectedTaskId}
        tasks={fixtureTasks}
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
    expect(screen.getByText('已将 接口联调 移动到已完成'))
      .toHaveAttribute('role', 'status')
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

    expect(await screen.findByText('移动失败，任务已恢复到原状态'))
      .toHaveAttribute('role', 'status')
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
})
