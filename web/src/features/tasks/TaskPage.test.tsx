import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Task } from '../../data/domain'
import { createFixtureSeed } from '../../data/fixtures'
import { projectRepository } from '../../data/query-hooks'
import { filterTasks } from './TaskFilters'
import { TaskInspector } from './TaskInspector'
import { TaskTable } from './TaskTable'

const fixtureTasks = createFixtureSeed().tasks

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 3) }, (_, index) => ({
        index,
        start: index * 44,
      })),
    measureElement: vi.fn(),
  }),
}))

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-default',
    code: 'TASK-DEFAULT',
    title: '默认任务',
    description: '测试任务',
    assignee: { id: 'human-lin', name: 'Lin', kind: 'human' },
    startDate: '2026-07-20',
    dueDate: '2026-07-28',
    priority: 'P1',
    status: 'in_progress',
    progress: 50,
    milestoneId: 'm2',
    dependencyIds: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('filterTasks', () => {
  it('combines validated status, assignee, and priority filters', () => {
    const result = filterTasks(fixtureTasks, new URLSearchParams({
      status: 'in_progress',
      assignee: 'human-lin',
      priority: 'P0',
    }))

    expect(result.map((item) => item.title)).toEqual(['MCP 权限校验'])
  })

  it('sorts due dates descending without mutating the source', () => {
    const first = task({ id: 'first', title: '先', dueDate: '2026-07-20' })
    const second = task({ id: 'second', title: '后', dueDate: '2026-07-30' })
    const source = [first, second]

    const result = filterTasks(source, new URLSearchParams('sort=due_desc'))

    expect(result.map((item) => item.id)).toEqual(['second', 'first'])
    expect(source.map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('defaults to a stable ascending due-date sort', () => {
    const source = [
      task({ id: 'later', dueDate: '2026-07-30' }),
      task({ id: 'tie-a', dueDate: '2026-07-20' }),
      task({ id: 'tie-b', dueDate: '2026-07-20' }),
    ]

    expect(filterTasks(source, new URLSearchParams()).map((item) => item.id))
      .toEqual(['tie-a', 'tie-b', 'later'])
  })

  it('ignores unknown enum and sort values safely', () => {
    const malicious = new URLSearchParams({
      status: '__proto__',
      priority: '<script>',
      sort: 'drop table tasks',
    })

    expect(() => filterTasks(fixtureTasks, malicious)).not.toThrow()
    expect(filterTasks(fixtureTasks, malicious)).toHaveLength(fixtureTasks.length)
    expect(filterTasks(fixtureTasks, malicious)[0]?.dueDate)
      .toBe('2026-07-23')
  })
})

describe('TaskPage workflow', () => {
  it('writes the overdue filter to the URL and only shows overdue work', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await screen.findByRole('button', { name: '查看 断线恢复测试' })
    await user.click(screen.getByRole('button', { name: '已延期' }))

    expect(window.location.search).toContain('status=overdue')
    expect(screen.getByRole('button', { name: '查看 断线恢复测试' }))
      .toBeVisible()
    expect(screen.queryByRole('button', { name: '查看 甘特图渲染' }))
      .not.toBeInTheDocument()
  })

  it('toggles the overdue filter off and restores the full result', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await screen.findByRole('button', { name: '查看 MCP 权限校验' })
    const overdue = screen.getByRole('button', { name: '已延期' })
    await user.click(overdue)
    expect(overdue).toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toContain('status=overdue')

    await user.click(overdue)

    expect(window.location.search).not.toContain('status=')
    expect(overdue).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '查看 甘特图渲染' }),
    ).toBeVisible()
  })

  it('closes and clears an inspector hidden by a new filter', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'MCP 权限校验' }),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: '已延期' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '任务工作台' }),
    ).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '已延期' }))
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates MCP permission validation to 80 percent', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'MCP 权限校验' })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '80')
    await user.click(within(dialog).getByRole('button', { name: '提交进度' }))

    await waitFor(() => {
      expect(screen.getAllByText('80%').length).toBeGreaterThan(0)
    })
  })

  it('rejects non-integer progress and retains the entered value', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'MCP 权限校验' })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '80.5')
    await user.click(within(dialog).getByRole('button', { name: '提交进度' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('0 到 100 的整数')
    expect(progress).toHaveValue(80.5)
  })

  it('retains form values when the update fails', async () => {
    vi.spyOn(projectRepository, 'updateTaskProgress').mockRejectedValueOnce(
      new Error('网络暂时不可用'),
    )
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'MCP 权限校验' })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    const note = within(dialog).getByRole('textbox', { name: '备注' })
    await user.clear(progress)
    await user.type(progress, '80')
    await user.type(note, '等待服务恢复')
    await user.click(within(dialog).getByRole('button', { name: '提交进度' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '网络暂时不可用',
    )
    expect(progress).toHaveValue(80)
    expect(note).toHaveValue('等待服务恢复')
  })

  it('resets the controlled form when the selected task changes', async () => {
    const user = userEvent.setup()
    const firstTask = task({
      id: 'first',
      title: '第一项任务',
      progress: 45,
      status: 'in_progress',
    })
    const secondTask = task({
      id: 'second',
      title: '第二项任务',
      progress: 10,
      status: 'not_started',
    })
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={firstTask} />,
    )

    const firstDialog = screen.getByRole('dialog', { name: '第一项任务' })
    const firstProgress = within(firstDialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(firstProgress)
    await user.type(firstProgress, '90')
    await user.type(
      within(firstDialog).getByRole('textbox', { name: '备注' }),
      '第一项备注',
    )

    rerender(<TaskInspector onClose={vi.fn()} task={secondTask} />)

    const secondDialog = screen.getByRole('dialog', { name: '第二项任务' })
    expect(
      within(secondDialog).getByRole('spinbutton', { name: '任务进度' }),
    ).toHaveValue(10)
    expect(
      within(secondDialog).getByRole('combobox', { name: '状态' }),
    ).toHaveValue('not_started')
    expect(
      within(secondDialog).getByRole('textbox', { name: '备注' }),
    ).toHaveValue('')
  })

  it('restores focus to the latest task trigger after switching tasks', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    const firstTrigger = await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    await user.click(firstTrigger)
    expect(
      screen.getByRole('dialog', { name: 'MCP 权限校验' }),
    ).toBeVisible()

    const latestTrigger = screen.getByRole('button', {
      name: '查看 断线恢复测试',
    })
    await user.click(latestTrigger)

    const latestDialog = screen.getByRole('dialog', {
      name: '断线恢复测试',
    })
    expect(
      within(latestDialog).getByRole('spinbutton', { name: '任务进度' }),
    ).toHaveValue(45)
    await user.click(
      within(latestDialog).getByRole('button', {
        name: '关闭 断线恢复测试',
      }),
    )

    expect(
      screen.getByRole('button', { name: '查看 断线恢复测试' }),
    ).toHaveFocus()
  })

  it('uses the shared six-column grid in the virtual table branch', () => {
    const virtualTasks = Array.from({ length: 101 }, (_, index) =>
      task({
        id: `virtual-${index}`,
        code: `VIRTUAL-${index}`,
        title: `虚拟任务 ${index}`,
      }),
    )
    const { container } = renderApp(
      <TaskTable
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={virtualTasks}
      />,
    )

    const table = screen.getByRole('table', { name: '任务列表' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(6)
    expect(within(table).getAllByRole('row')[0]).toHaveClass(
      'task-table__grid-row',
    )
    const virtualBody = container.querySelector(
      '.task-table__virtual-body',
    )
    expect(virtualBody).toBeInTheDocument()
    const renderedRows = within(virtualBody as HTMLElement).getAllByRole('row')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows[0]).toHaveClass('task-table__grid-row')
    expect(within(renderedRows[0]!).getAllByRole('cell')).toHaveLength(6)
  })
})
