import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../../app/router'
import { renderApp } from '../../app/test-utils'
import type { Project, Task } from '../../data/domain'
import { createFixtureSeed } from '../../data/fixtures'
import {
  projectQueryKeys,
  projectRepository,
} from '../../data/query-hooks'
import { filterTasks } from './TaskFilters'
import { TaskContextPanel } from './TaskContextPanel'
import { TaskInspector } from './TaskInspector'
import { TaskPage } from './TaskPage'
import { TaskTable } from './TaskTable'
import tasksGlassCss from './tasks-glass.css?raw'

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

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'atlas',
    code: 'ATLAS',
    name: 'Atlas 研发平台',
    description: '研发项目',
    ownerId: 'human-lin',
    startDate: '2026-07-01',
    dueDate: '2026-08-31',
    status: 'in_progress',
    progress: 62,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function renderTaskPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  )
  return {
    queryClient,
    ...render(<TaskPage />, { wrapper }),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
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

  it.each([
    ['code', '  task-code  ', 'code-match'],
    ['title', 'migration', 'title-match'],
    ['description', 'legacy data', 'description-match'],
    ['assignee name', 'casey owner', 'assignee-match'],
    ['project id', 'project-atlas', 'project-match'],
  ])('matches a trimmed case-insensitive query by %s', (_field, query, id) => {
    const source = [
      task({ id: 'code-match', code: 'TASK-CODE' }),
      task({ id: 'title-match', title: 'History MIGRATION' }),
      task({ id: 'description-match', description: 'Move LEGACY DATA safely' }),
      task({
        id: 'assignee-match',
        assignee: { id: 'casey', name: 'Casey Owner', kind: 'human' },
      }),
      task({ id: 'project-match', projectId: 'PROJECT-ATLAS' }),
    ]

    expect(filterTasks(source, new URLSearchParams({ q: query })))
      .toEqual([expect.objectContaining({ id })])
  })
})

describe('TaskPage workflow', () => {
  it('renders the fan workspace without an independent delivery timeline', async () => {
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'done-early',
        code: 'TASK-DONE',
        title: '已完成早期任务',
        dueDate: '2026-07-01',
        priority: 'P3',
        status: 'done',
      }),
      task({
        id: 'overdue-p0',
        code: 'TASK-RISK',
        title: '首要风险任务',
        dueDate: '2026-07-30',
        priority: 'P0',
        status: 'overdue',
      }),
    ])
    renderApp(<TaskPage />)

    const workspace = await screen.findByTestId('task-workspace')
    const filterToolbar = screen.getByTestId('task-filter-toolbar')
    expect(
      within(filterToolbar).getByRole('region', { name: '任务筛选' }),
    ).toBeVisible()
    expect(workspace).toHaveClass('task-multiview-workspace')
    expect(
      Array.from(workspace.children).map((node) =>
        node.getAttribute('data-slot'),
      ),
    ).toEqual(['stage', 'context'])
    const stage = within(workspace).getByTestId('task-view-stage')
    expect(stage).toHaveAttribute('data-view', 'fan')
    expect(stage.nextElementSibling).toBe(
      within(workspace).getByRole('region', { name: '智能任务上下文' }),
    )
    const list = within(stage).getByRole('region', { name: '任务列表' })
    expect(list).toBeVisible()
    expect(within(list).queryByRole('region', { name: '任务筛选' }))
      .not.toBeInTheDocument()
    expect(
      within(stage).getByRole('region', { name: '关键任务扇面' }),
    ).toBeVisible()
    const context = within(workspace).getByRole('region', {
      name: '智能任务上下文',
    })
    expect(context).toHaveTextContent('首要风险任务')
    expect(context.querySelector('.task-context__scroll')).toBeVisible()
    expect(await within(context).findByText('Atlas')).toBeVisible()
    const synchronizedTriggers = within(workspace).getAllByRole('button', {
      name: /首要风险任务/,
    })
    expect(synchronizedTriggers).toHaveLength(2)
    synchronizedTriggers.forEach((trigger) => {
      expect(trigger).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).not.toContain('selected=')

    expect(screen.queryByRole('region', { name: '独立交付时间线' }))
      .not.toBeInTheDocument()
    expect(filterToolbar.nextElementSibling).toBe(workspace)
  })

  it('uses one persistent context as an accessible compact detail drawer', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />)

    const opener = await screen.findByRole('button', {
      name: '查看任务详情',
    })
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const contextId = opener.getAttribute('aria-controls')
    expect(contextId).toBeTruthy()
    expect(context).toHaveAttribute('id', contextId)
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelectorAll('.task-context')).toHaveLength(1)
    expect(document.querySelectorAll('.task-inspector__form')).toHaveLength(1)

    await user.click(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'true')
    const drawer = screen.getByRole('dialog', { name: '断线恢复测试' })
    expect(drawer).toBe(context)
    expect(drawer).toHaveClass('task-context-drawer')
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    const close = within(drawer).getByRole('button', {
      name: '关闭任务详情',
    })
    expect(close).toHaveFocus()

    const drawerButtons = within(drawer).getAllByRole('button')
    const lastDrawerButton = drawerButtons.at(-1)!
    await user.tab({ shift: true })
    expect(lastDrawerButton).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(opener).toHaveFocus()
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toBeInTheDocument()
    expect(document.querySelectorAll('.task-context')).toHaveLength(1)
    expect(document.querySelectorAll('.task-inspector__form')).toHaveLength(1)
  })

  it('opens the shared drawer with the latest selection and closes from its backdrop', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />)

    await user.click(await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    }))
    const opener = screen.getByRole('button', { name: '查看任务详情' })
    await user.click(opener)

    const drawer = screen.getByRole('dialog', { name: 'MCP 权限校验' })
    expect(drawer).toHaveTextContent('MCP 权限校验')
    expect(document.querySelectorAll('.task-context')).toHaveLength(1)
    expect(document.querySelectorAll('.task-inspector__form')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '关闭任务详情遮罩' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('uses a controlled search and preserves view while clearing selection', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?view=board&selected=task-047&status=overdue&q=断线',
    })

    const search = await screen.findByRole('searchbox', { name: '搜索任务' })
    expect(search).toHaveValue('断线')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')

    await user.clear(search)
    await user.type(search, '恢复')

    const params = new URLSearchParams(window.location.search)
    expect(params.get('q')).toBe('恢复')
    expect(params.get('view')).toBe('board')
    expect(params.get('status')).toBe('overdue')
    expect(params.has('selected')).toBe(false)
  })

  it('keeps selection and filters when switching task views', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?view=board&selected=task-047&status=overdue',
    })

    const switcher = await screen.findByRole('group', { name: '任务视图' })
    expect(within(switcher).getByRole('button', { name: '看板' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: '任务看板工作区' })).toBeVisible()
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')

    await user.click(within(switcher).getByRole('button', { name: '时间线' }))

    const params = new URLSearchParams(window.location.search)
    expect(params.get('view')).toBe('timeline')
    expect(params.get('selected')).toBe('task-047')
    expect(params.get('status')).toBe('overdue')
    expect(screen.getByRole('region', { name: '任务时间线工作区' }))
      .toBeVisible()
    expect(screen.getByRole('button', {
      name: '选择 TASK-047 断线恢复测试',
    })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /TASK-052/ }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
  })

  it('falls back to fan for an invalid view and removes view for fan', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?view=invalid&selected=task-047&priority=P0',
    })

    const switcher = await screen.findByRole('group', { name: '任务视图' })
    const fan = within(switcher).getByRole('button', { name: '扇面' })
    expect(fan).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: '关键任务扇面' })).toBeVisible()

    await user.click(fan)

    const params = new URLSearchParams(window.location.search)
    expect(params.has('view')).toBe(false)
    expect(params.get('selected')).toBe('task-047')
    expect(params.get('priority')).toBe('P0')
  })

  it('shortens opaque project ids in the persistent context', () => {
    const opaqueProjectId = '7ff2589e-b92c-44e2-812c-00997cdd4527'
    renderApp(
      <TaskContextPanel
        projectName="项目 7ff2589e…4527"
        task={task({ projectId: opaqueProjectId })}
        today="2026-08-03"
      />,
    )

    const context = screen.getByRole('region', { name: '智能任务上下文' })
    expect(context).not.toHaveTextContent(opaqueProjectId)
    expect(context).toHaveTextContent('项目 7ff2589e…4527')
  })

  it('renders only real selected-task facts and deterministic insights', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 3, 12))
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue([
      project(),
    ])
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'task-overdue-context',
        code: 'TASK-REAL-17',
        title: '真实逾期任务',
        description: '只展示仓库中持久化的任务事实。',
        projectId: 'atlas',
        assignee: { id: 'human-maya', name: 'Maya', kind: 'human' },
        startDate: '2026-07-18',
        dueDate: '2026-08-01',
        priority: 'P0',
        status: 'overdue',
        progress: 27,
        milestoneId: 'release-1',
        dependencyIds: ['task-blocker-a', 'task-blocker-b'],
      }),
    ])

    renderApp(<TaskPage />, {
      route: '/tasks?selected=task-overdue-context',
    })

    const context = await screen.findByRole('region', {
      name: '智能任务上下文',
    })
    expect(context).toHaveTextContent('TASK-REAL-17')
    expect(context).toHaveTextContent('Maya')
    expect(context).toHaveTextContent('Atlas 研发平台')
    expect(context).toHaveTextContent('P0')
    expect(context).toHaveTextContent('已逾期')
    expect(context).toHaveTextContent('2026-07-18')
    expect(context).toHaveTextContent('2026-08-01')
    expect(context).toHaveTextContent('27%')
    expect(context).toHaveTextContent('2 项')
    const dependencies = within(context).getByRole('list', {
      name: '依赖任务',
    })
    expect(within(dependencies).getAllByRole('listitem')).toHaveLength(2)
    expect(dependencies).toHaveTextContent('task-blocker-a')
    expect(dependencies).toHaveTextContent('task-blocker-b')
    expect(context).toHaveTextContent('release-1')
    expect(context).toHaveTextContent('只展示仓库中持久化的任务事实。')
    expect(within(context).getByRole('heading', { name: '任务建议' }))
      .toBeVisible()
    expect(context).toHaveTextContent('任务已逾期，请重新确认交付时间。')
    expect(context).toHaveTextContent(
      '存在 2 项前置依赖，请确认阻塞状态。',
    )
    expect(context).not.toHaveTextContent('历史任务')
    expect(context).not.toHaveTextContent('AI 助手')
    expect(context).not.toHaveTextContent('3 份')
    expect(context).not.toHaveTextContent('关键路径')
  })

  it('shows only the real milestone as a tag, or an explicit empty tag state', () => {
    const { rerender } = renderApp(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={task({ milestoneId: 'milestone-real' })}
        today="2026-08-03"
      />,
    )

    const context = screen.getByRole('region', { name: '智能任务上下文' })
    expect(context).toHaveTextContent('milestone-real')
    expect(context).not.toHaveTextContent('暂无标签')

    rerender(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={task({ milestoneId: '' })}
        today="2026-08-03"
      />,
    )

    expect(context).toHaveTextContent('暂无标签')
    expect(context).not.toHaveTextContent('milestone-real')
  })

  it('falls back to a shortened opaque project id when projects have no match', async () => {
    const opaqueProjectId = '7ff2589e-b92c-44e2-812c-00997cdd4527'
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue([])
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({ projectId: opaqueProjectId }),
    ])

    renderApp(<TaskPage />)

    const context = await screen.findByRole('region', {
      name: '智能任务上下文',
    })
    expect(context).not.toHaveTextContent(opaqueProjectId)
    expect(context).toHaveTextContent('项目 7ff2589e…4527')
  })

  it('keeps task context visible while project names load, then updates it', async () => {
    let resolveProjects: (projects: Project[]) => void = () => undefined
    const projectsPromise = new Promise<Project[]>((resolve) => {
      resolveProjects = resolve
    })
    vi.spyOn(projectRepository, 'listProjects').mockReturnValue(projectsPromise)
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({ projectId: 'atlas', title: '项目名加载中的任务' }),
    ])

    renderApp(<TaskPage />)

    const context = await screen.findByRole('region', {
      name: '智能任务上下文',
    })
    expect(context).toHaveTextContent('项目名加载中的任务')
    expect(context).toHaveTextContent('项目 atlas')

    await act(async () => {
      resolveProjects([project()])
    })

    expect(await within(context).findByText('Atlas 研发平台')).toBeVisible()
  })

  it('keeps task context visible when the project-name query fails', async () => {
    vi.spyOn(projectRepository, 'listProjects').mockRejectedValue(
      new Error('项目索引不可访问'),
    )
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({ projectId: 'atlas', title: '项目索引失败时的任务' }),
    ])

    renderApp(<TaskPage />)

    const context = await screen.findByRole('region', {
      name: '智能任务上下文',
    })
    expect(context).toHaveTextContent('项目索引失败时的任务')
    expect(context).toHaveTextContent('项目 atlas')
    expect(screen.queryByRole('heading', { name: '无法读取本地项目数据' }))
      .not.toBeInTheDocument()
  })

  it('bounds a large dependency list until the user explicitly expands it', async () => {
    const user = userEvent.setup()
    const dependencyIds = Array.from(
      { length: 1_000 },
      (_, index) => `dependency-${index}-${'x'.repeat(80)}`,
    )
    const firstTask = task({
      id: 'large-dependencies',
      dependencyIds,
    })
    const { rerender } = renderApp(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={firstTask}
        today="2026-08-03"
      />,
    )

    const context = screen.getByRole('region', { name: '智能任务上下文' })
    expect(context).toHaveTextContent('1000 项')
    expect(context).toHaveTextContent('另 995 项')
    expect(context).toHaveTextContent(dependencyIds[0]!)
    expect(context).not.toHaveTextContent(dependencyIds.at(-1)!)
    expect(context.querySelectorAll('.task-context__dependencies li'))
      .toHaveLength(5)

    const expand = within(context).getByRole('button', {
      name: '展开全部依赖',
    })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    await user.click(expand)

    expect(context).toHaveTextContent(dependencyIds.at(-1)!)
    expect(context.querySelectorAll('.task-context__dependencies li'))
      .toHaveLength(1_000)
    const collapse = within(context).getByRole('button', {
      name: '收起依赖',
    })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await user.click(collapse)
    expect(context).not.toHaveTextContent(dependencyIds.at(-1)!)

    await user.click(within(context).getByRole('button', {
      name: '展开全部依赖',
    }))
    rerender(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={task({ id: 'next-task', dependencyIds })}
        today="2026-08-03"
      />,
    )
    expect(within(context).getByRole('button', { name: '展开全部依赖' }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(context).not.toHaveTextContent(dependencyIds.at(-1)!)
  })

  it('shows zero and small dependency sets without an expansion control', () => {
    const { rerender } = renderApp(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={task({ dependencyIds: [] })}
        today="2026-08-03"
      />,
    )
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    expect(context).toHaveTextContent('0 项')
    expect(within(context).queryByRole('button', { name: /依赖/ }))
      .not.toBeInTheDocument()

    rerender(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={task({ dependencyIds: ['task-a', 'task-b'] })}
        today="2026-08-03"
      />,
    )
    const dependencies = within(context).getByRole('list', {
      name: '依赖任务',
    })
    expect(within(dependencies).getAllByRole('listitem')).toHaveLength(2)
    expect(dependencies).toHaveTextContent('task-a')
    expect(dependencies).toHaveTextContent('task-b')
    expect(within(context).queryByRole('button', { name: /依赖/ }))
      .not.toBeInTheDocument()
  })

  it('uses a generated id to associate insights for special task ids', () => {
    renderApp(
      <TaskContextPanel
        projectName="Atlas 研发平台"
        task={task({ id: 'task id/特殊?#[]' })}
        today="2026-08-03"
      />,
    )

    const insights = document.querySelector('.task-context__insights')
    expect(insights).not.toBeNull()
    const labelledBy = insights?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(labelledBy).not.toContain('task id/特殊?#[]')
    expect(document.getElementById(labelledBy!)).toHaveTextContent('任务建议')
  })

  it('uses the shared glass header and derives four metrics from task data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 28, 12))
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'today',
        code: 'TASK-TODAY',
        title: '今日交付',
        dueDate: '2026-07-28',
        status: 'not_started',
        progress: 0,
      }),
      task({
        id: 'active',
        code: 'TASK-ACTIVE',
        title: '持续推进',
        dueDate: '2026-07-30',
      }),
      task({
        id: 'done',
        code: 'TASK-DONE',
        title: '完成交付',
        status: 'done',
        progress: 100,
      }),
      task({
        id: 'overdue',
        code: 'TASK-OVERDUE',
        title: '风险任务',
        status: 'overdue',
      }),
    ])
    const { container } = renderApp(<TaskPage />)

    expect(
      await screen.findByRole('heading', { name: '任务控制台' }),
    ).toBeVisible()
    expect(container.querySelector('.page-header')).toBeInTheDocument()
    const metrics = screen.getByRole('group', { name: '任务关键指标' })
    expect(metrics).toHaveClass('metric-grid')
    const values = Object.fromEntries(
      Array.from(metrics.querySelectorAll<HTMLElement>('[data-metric]')).map(
        (metric) => [
          metric.dataset.metric,
          within(metric).getByTestId('metric-value').textContent,
        ],
      ),
    )
    expect(values).toEqual({
      今日待办: '1',
      进行中: '1',
      已完成: '1',
      逾期: '1',
    })
    expect(metrics.querySelectorAll('.glass-panel')).toHaveLength(4)
  })

  it('derives today tasks from the current local business date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 28, 12))
    vi.spyOn(projectRepository, 'listTasks').mockResolvedValue([
      task({
        id: 'july-28',
        code: 'TASK-JULY-28',
        title: '七月二十八日任务',
        dueDate: '2026-07-28',
        status: 'not_started',
        progress: 0,
      }),
      task({
        id: 'july-29-a',
        code: 'TASK-JULY-29-A',
        title: '七月二十九日任务一',
        dueDate: '2026-07-29',
        status: 'not_started',
        progress: 0,
      }),
      task({
        id: 'july-29-b',
        code: 'TASK-JULY-29-B',
        title: '七月二十九日任务二',
        dueDate: '2026-07-29',
        status: 'in_progress',
      }),
    ])
    const { rerender } = renderApp(<TaskPage />)

    await screen.findByRole('heading', { name: '任务控制台' })
    const todayValue = () => {
      const metric = screen.getByText('今日待办').closest('[data-metric]')
      expect(metric).not.toBeNull()
      return within(metric as HTMLElement).getByTestId('metric-value')
    }
    expect(todayValue()).toHaveTextContent('1')
    expect(screen.getByText(/以 2026-07-28 为今日基准/)).toBeVisible()

    vi.setSystemTime(new Date(2026, 6, 29, 12))
    rerender(<TaskPage />)

    expect(todayValue()).toHaveTextContent('2')
    expect(screen.getByText(/以 2026-07-29 为今日基准/)).toBeVisible()
  })

  it('keeps the complete filtered compact list beside the six-card fan', async () => {
    renderApp(<TaskPage />)

    const fan = await screen.findByRole('region', { name: '关键任务扇面' })
    expect(within(fan).getAllByRole('button')).toHaveLength(6)
    const list = screen.getByRole('region', { name: '任务列表' })
    expect(
      within(list).getByRole('button', { name: '查看 甘特图渲染' }),
    ).toBeVisible()
    expect(within(list).getAllByRole('button', { name: /^查看 / }))
      .toHaveLength(fixtureTasks.length)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('links a fan selection through the URL, list, and persistent context', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?priority=P0&sort=due_desc',
    })

    const fanTrigger = await screen.findByRole('button', {
      name: '选择 TASK-047 断线恢复测试',
    })
    await user.click(fanTrigger)

    expect(window.location.search).toContain('priority=P0')
    expect(window.location.search).toContain('sort=due_desc')
    expect(window.location.search).toContain('selected=task-047')
    expect(fanTrigger).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '查看 断线恢复测试' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps focus on the fan trigger without opening an inspector dialog', async () => {
    const user = userEvent.setup()
    renderApp(<TaskPage />, {
      route: '/tasks?priority=P0&sort=due_desc',
    })

    const fanTrigger = await screen.findByRole('button', {
      name: '选择 TASK-047 断线恢复测试',
    })
    expect(fanTrigger).toHaveAttribute('id', 'task-fan-trigger-task-047')
    await user.click(fanTrigger)

    expect(fanTrigger).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps page width bounded while signature regions own their scrolling', () => {
    expect(tasksGlassCss).toMatch(
      /\.task-page\s*{[^}]*overflow-x:\s*clip/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-timeline__scroll\s*{[^}]*min-width:\s*0[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-inline:\s*contain/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-timeline__chart\s*{[^}]*position:\s*relative[^}]*min-width:\s*46rem/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-timeline__track\s*{[^}]*position:\s*relative[^}]*min-width:\s*28rem/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-timeline__bar\s*{[^}]*position:\s*absolute/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-timeline__today\s*{[^}]*position:\s*absolute/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-multiview-workspace\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(17rem,\s*0\.34fr\)/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-view-stage[^}]*\.task-context\s*{[^}]*min-width:\s*0/s,
    )
    expect(tasksGlassCss).not.toMatch(
      /\.task-workspace\s*{[^}]*height:\s*clamp\(350px,\s*42vh,\s*380px\)/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-context__scroll\s*{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s,
    )
    expect(tasksGlassCss).toMatch(
      /\.task-filter-toolbar\s+\.task-filters\s*{[^}]*grid-template-columns:[^}]*overflow-x:\s*auto/s,
    )
    expect(tasksGlassCss).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.task-context-drawer\s*{[^}]*position:\s*fixed/s,
    )
    expect(tasksGlassCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.task-context-drawer[^}]*transition:\s*none/s,
    )
  })

  it('uses shared loading, error with retry, and empty states', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'listTasks').mockImplementationOnce(
      () => new Promise(() => {}),
    )
    const loading = renderApp(<AppRoutes />, { route: '/tasks' })
    expect(
      await screen.findByRole('status', { name: '正在加载项目数据' }),
    ).toBeVisible()
    loading.unmount()

    const listTasks = vi.spyOn(projectRepository, 'listTasks')
    listTasks.mockReset()
      .mockRejectedValueOnce(new Error('数据库文件不可访问'))
      .mockResolvedValueOnce([])
    const error = renderApp(<AppRoutes />, { route: '/tasks' })
    expect(
      await screen.findByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('当前项目暂无任务')).toBeVisible()
    error.unmount()
  })

  it('retains task content while a background refresh is pending', async () => {
    vi.spyOn(projectRepository, 'listTasks')
      .mockResolvedValueOnce(fixtureTasks)
      .mockImplementationOnce(() => new Promise(() => {}))
    const { queryClient } = renderTaskPage()

    await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    act(() => {
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks })
    })

    expect(
      await screen.findByRole('status', { name: '正在刷新项目数据' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
  })

  it('retains task content and warns when a background refresh fails', async () => {
    vi.spyOn(projectRepository, 'listTasks')
      .mockResolvedValueOnce(fixtureTasks)
      .mockRejectedValueOnce(new Error('数据库文件不可访问'))
    const { queryClient } = renderTaskPage()

    await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '刷新失败，正在显示上次数据。数据库文件不可访问',
    )
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
  })

  it('shows a valid visible task from the selected query parameter in context', async () => {
    renderApp(<AppRoutes />, {
      route: '/tasks?selected=task-047',
    })

    const context = await screen.findByRole('region', {
      name: '智能任务上下文',
    })
    expect(within(context).getByText('TASK-047')).toBeVisible()
    expect(context).toHaveTextContent('断线恢复测试')
    expect(
      screen.getByRole('button', { name: '查看 断线恢复测试' }),
    ).toBeVisible()
  })

  it('falls back from missing, invalid, and filter-hidden selections', async () => {
    const missing = renderApp(<AppRoutes />, {
      route: '/tasks?selected=missing-task',
    })
    expect(await screen.findByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    missing.unmount()

    const hidden = renderApp(<AppRoutes />, {
      route: '/tasks?status=done&selected=task-047',
    })
    expect(await screen.findByRole('region', { name: '智能任务上下文' }))
      .not.toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    hidden.unmount()

    renderApp(<AppRoutes />, {
      route: '/tasks?selected=%3Cscript%3E',
    })
    expect(await screen.findByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stores compact-list selection in the URL without dropping filters', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, {
      route: '/tasks?priority=P0&sort=due_desc',
    })

    const listTrigger = await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    expect(listTrigger).toHaveAttribute('id', 'task-list-trigger-task-051')
    await user.click(listTrigger)
    expect(window.location.search).toContain('priority=P0')
    expect(window.location.search).toContain('sort=due_desc')
    expect(window.location.search).toContain('selected=task-051')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('MCP 权限校验')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('writes the overdue filter to the URL and only shows overdue work', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, {
      route: '/tasks?view=fan&selected=task-051',
    })

    await screen.findByRole('button', { name: '查看 断线恢复测试' })
    await user.click(screen.getByRole('button', { name: '已延期' }))

    const params = new URLSearchParams(window.location.search)
    expect(params.get('status')).toBe('overdue')
    expect(params.get('view')).toBe('fan')
    expect(params.has('selected')).toBe(false)
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

  it('falls back to visible persistent context when a filter hides selection', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('MCP 权限校验')

    await user.click(screen.getByRole('button', { name: '已延期' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).not.toContain('selected=')
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('断线恢复测试')

    await user.click(screen.getByRole('button', { name: '已延期' }))
    expect(
      screen.getByRole('button', { name: '查看 MCP 权限校验' }),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates MCP permission validation to 80 percent', async () => {
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const progress = within(context).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '80')
    await user.click(within(context).getByRole('button', { name: '提交进度' }))

    await waitFor(() => expect(updateProgress).toHaveBeenCalledWith(
      'task-051',
      expect.objectContaining({ progress: 80 }),
    ))
    expect(progress).toHaveValue(80)
  })

  it('rejects non-integer progress and retains the entered value', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    await user.click(
      await screen.findByRole('button', { name: '查看 MCP 权限校验' }),
    )
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const progress = within(context).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '80.5')
    await user.click(within(context).getByRole('button', { name: '提交进度' }))

    expect(within(context).getByRole('alert')).toHaveTextContent('0 到 100 的整数')
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
    const context = screen.getByRole('region', { name: '智能任务上下文' })
    const progress = within(context).getByRole('spinbutton', {
      name: '任务进度',
    })
    const note = within(context).getByRole('textbox', { name: '进度备注' })
    await user.clear(progress)
    await user.type(progress, '80')
    await user.type(note, '等待服务恢复')
    await user.click(within(context).getByRole('button', { name: '提交进度' }))

    expect(await within(context).findByRole('alert')).toHaveTextContent(
      '网络暂时不可用',
    )
    expect(progress).toHaveValue(80)
    expect(note).toHaveValue('等待服务恢复')
  })

  it('synchronizes clean progress fields when the same task updates externally', () => {
    const original = task({
      id: 'same-task-clean',
      progress: 45,
      status: 'in_progress',
    })
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...original, progress: 100, status: 'done' }}
      />,
    )

    expect(within(dialog).getByRole('spinbutton', { name: '任务进度' }))
      .toHaveValue(100)
    expect(within(dialog).getByRole('combobox', { name: '状态' }))
      .toHaveValue('done')
  })

  it('preserves dirty progress and note while syncing a clean status field', async () => {
    const user = userEvent.setup()
    const original = task({
      id: 'same-task-draft',
      progress: 45,
      status: 'in_progress',
    })
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    const note = within(dialog).getByRole('textbox', { name: '进度备注' })
    await user.clear(progress)
    await user.type(progress, '73')
    await user.type(note, '保留这段草稿')

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...original, progress: 90, status: 'done' }}
      />,
    )

    expect(progress).toHaveValue(73)
    expect(within(dialog).getByRole('combobox', { name: '状态' }))
      .toHaveValue('done')
    expect(note).toHaveValue('保留这段草稿')
  })

  it('submits an externally updated clean status without reverting it', async () => {
    const updatedTask = task({
      id: 'same-task-submit',
      progress: 90,
      status: 'done',
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockResolvedValue(updatedTask)
    const user = userEvent.setup()
    const original = { ...updatedTask, progress: 45, status: 'in_progress' as const }
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '73')

    rerender(<TaskInspector onClose={vi.fn()} task={updatedTask} />)
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))

    await waitFor(() => expect(updateProgress).toHaveBeenCalledWith(
      'same-task-submit',
      expect.objectContaining({ progress: 73, status: 'done' }),
    ))
  })

  it('ignores a successful response after switching to another task', async () => {
    const request = deferred<Task>()
    const firstTask = task({
      id: 'late-success-a',
      title: '迟到成功 A',
      progress: 40,
      status: 'in_progress',
    })
    const secondTask = task({
      id: 'late-success-b',
      title: '当前任务 B',
      progress: 15,
      status: 'not_started',
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={firstTask} />,
    )
    const firstDialog = screen.getByRole('dialog', { name: firstTask.title })
    await user.type(
      within(firstDialog).getByRole('textbox', { name: '进度备注' }),
      'A 的备注',
    )
    await user.click(within(firstDialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    rerender(<TaskInspector onClose={vi.fn()} task={secondTask} />)
    const secondDialog = screen.getByRole('dialog', { name: secondTask.title })
    const secondNote = within(secondDialog).getByRole('textbox', {
      name: '进度备注',
    })
    await user.type(secondNote, 'B 的草稿')

    await act(async () => {
      request.resolve({ ...firstTask, progress: 70, status: 'done' })
      await request.promise
    })

    expect(within(secondDialog).getByRole('spinbutton', { name: '任务进度' }))
      .toHaveValue(15)
    expect(within(secondDialog).getByRole('combobox', { name: '状态' }))
      .toHaveValue('not_started')
    expect(secondNote).toHaveValue('B 的草稿')
    expect(within(secondDialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores a failed response after switching to another task', async () => {
    const request = deferred<Task>()
    const firstTask = task({ id: 'late-error-a', title: '迟到失败 A' })
    const secondTask = task({
      id: 'late-error-b',
      title: '失败后的当前任务 B',
      progress: 25,
      status: 'done',
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={firstTask} />,
    )
    const firstDialog = screen.getByRole('dialog', { name: firstTask.title })
    await user.click(within(firstDialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    rerender(<TaskInspector onClose={vi.fn()} task={secondTask} />)
    const secondDialog = screen.getByRole('dialog', { name: secondTask.title })
    const secondNote = within(secondDialog).getByRole('textbox', {
      name: '进度备注',
    })
    await user.type(secondNote, '继续编辑 B')

    await act(async () => {
      request.reject(new Error('A 请求迟到失败'))
      await request.promise.catch(() => undefined)
    })

    expect(within(secondDialog).getByRole('spinbutton', { name: '任务进度' }))
      .toHaveValue(25)
    expect(within(secondDialog).getByRole('combobox', { name: '状态' }))
      .toHaveValue('done')
    expect(secondNote).toHaveValue('继续编辑 B')
    expect(within(secondDialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves progress edits made after a request was submitted', async () => {
    const request = deferred<Task>()
    const submittedTask = task({
      id: 'post-submit-progress',
      progress: 40,
      status: 'in_progress',
    })
    vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    renderApp(<TaskInspector onClose={vi.fn()} task={submittedTask} />)
    const dialog = screen.getByRole('dialog', { name: submittedTask.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '70')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await user.clear(progress)
    await user.type(progress, '80')

    await act(async () => {
      request.resolve({ ...submittedTask, progress: 70 })
      await request.promise
    })

    expect(progress).toHaveValue(80)
  })

  it('preserves status edits made after a request was submitted', async () => {
    const request = deferred<Task>()
    const submittedTask = task({
      id: 'post-submit-status',
      progress: 40,
      status: 'in_progress',
    })
    vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    renderApp(<TaskInspector onClose={vi.fn()} task={submittedTask} />)
    const dialog = screen.getByRole('dialog', { name: submittedTask.title })
    const status = within(dialog).getByRole('combobox', { name: '状态' })
    await user.selectOptions(status, 'done')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await user.selectOptions(status, 'overdue')

    await act(async () => {
      request.resolve({ ...submittedTask, status: 'done' })
      await request.promise
    })

    expect(status).toHaveValue('overdue')
  })

  it('does not replace a newer external status with an older save response', async () => {
    const request = deferred<Task>()
    const original = task({
      id: 'external-status-during-save',
      progress: 40,
      status: 'in_progress',
      version: 1,
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    const status = within(dialog).getByRole('combobox', { name: '状态' })
    await user.clear(progress)
    await user.type(progress, '70')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...original, status: 'overdue', version: 2 }}
      />,
    )
    expect(status).toHaveValue('overdue')

    await act(async () => {
      request.resolve({
        ...original,
        progress: 70,
        status: 'in_progress',
        version: 2,
      })
      await request.promise
    })

    expect(progress).toHaveValue(70)
    expect(status).toHaveValue('overdue')
  })

  it('does not replace newer external progress with an older save response', async () => {
    const request = deferred<Task>()
    const original = task({
      id: 'external-progress-during-save',
      progress: 40,
      status: 'in_progress',
      version: 1,
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    const status = within(dialog).getByRole('combobox', { name: '状态' })
    await user.selectOptions(status, 'done')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...original, progress: 80, version: 2 }}
      />,
    )
    expect(progress).toHaveValue(80)

    await act(async () => {
      request.resolve({
        ...original,
        progress: 40,
        status: 'done',
        version: 2,
      })
      await request.promise
    })

    expect(progress).toHaveValue(80)
    expect(status).toHaveValue('done')
  })

  it('unlocks fields when the external source already matches the save response', async () => {
    const request = deferred<Task>()
    const original = task({
      id: 'matching-source-during-save',
      progress: 40,
      status: 'in_progress',
      version: 1,
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    const status = within(dialog).getByRole('combobox', { name: '状态' })
    await user.clear(progress)
    await user.type(progress, '70')
    await user.selectOptions(status, 'done')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    const matchingSource = {
      ...original,
      progress: 70,
      status: 'done' as const,
      version: 2,
    }
    rerender(<TaskInspector onClose={vi.fn()} task={matchingSource} />)
    await act(async () => {
      request.resolve(matchingSource)
      await request.promise
    })

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{
          ...matchingSource,
          progress: 90,
          status: 'overdue',
          version: 3,
        }}
      />,
    )

    expect(progress).toHaveValue(90)
    expect(status).toHaveValue('overdue')
  })

  it('adopts newer external progress over the submitted draft and unlocks it', async () => {
    const request = deferred<Task>()
    const original = task({
      id: 'dirty-progress-newer-source',
      progress: 40,
      status: 'in_progress',
      version: 1,
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '70')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    const newerSource = { ...original, progress: 100, version: 2 }
    rerender(<TaskInspector onClose={vi.fn()} task={newerSource} />)
    expect(progress).toHaveValue(70)

    await act(async () => {
      request.resolve({ ...original, progress: 70, version: 2 })
      await request.promise
    })
    expect(progress).toHaveValue(100)

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...newerSource, progress: 90, version: 3 }}
      />,
    )
    expect(progress).toHaveValue(90)
  })

  it('adopts newer external status over the submitted draft and unlocks it', async () => {
    const request = deferred<Task>()
    const original = task({
      id: 'dirty-status-newer-source',
      progress: 40,
      status: 'in_progress',
      version: 1,
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const status = within(dialog).getByRole('combobox', { name: '状态' })
    await user.selectOptions(status, 'done')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    const newerSource = { ...original, status: 'overdue' as const, version: 2 }
    rerender(<TaskInspector onClose={vi.fn()} task={newerSource} />)
    expect(status).toHaveValue('done')

    await act(async () => {
      request.resolve({ ...original, status: 'done', version: 2 })
      await request.promise
    })
    expect(status).toHaveValue('overdue')

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...newerSource, status: 'not_started', version: 3 }}
      />,
    )
    expect(status).toHaveValue('not_started')
  })

  it('keeps a post-submit user edit ahead of newer source and save response', async () => {
    const request = deferred<Task>()
    const original = task({
      id: 'post-submit-user-wins-source',
      progress: 40,
      version: 1,
    })
    const updateProgress = vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { rerender } = renderApp(
      <TaskInspector onClose={vi.fn()} task={original} />,
    )
    const dialog = screen.getByRole('dialog', { name: original.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    await user.clear(progress)
    await user.type(progress, '70')
    await user.click(within(dialog).getByRole('button', {
      name: '提交进度',
    }))
    await waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))

    rerender(
      <TaskInspector
        onClose={vi.fn()}
        task={{ ...original, progress: 100, version: 2 }}
      />,
    )
    await user.clear(progress)
    await user.type(progress, '80')

    await act(async () => {
      request.resolve({ ...original, progress: 70, version: 2 })
      await request.promise
    })

    expect(progress).toHaveValue(80)
  })

  it('lets only the latest consecutive request report errors or own fields', async () => {
    const oldSuccess = deferred<Task>()
    const oldFailure = deferred<Task>()
    const latestRequest = deferred<Task>()
    const requests = [oldSuccess, oldFailure, latestRequest]
    const submittedTask = task({
      id: 'consecutive-submit',
      progress: 40,
      status: 'in_progress',
    })
    vi.spyOn(projectRepository, 'updateTaskProgress')
      .mockImplementation(() => requests.shift()!.promise)
    const user = userEvent.setup()
    renderApp(<TaskInspector onClose={vi.fn()} task={submittedTask} />)
    const dialog = screen.getByRole('dialog', { name: submittedTask.title })
    const progress = within(dialog).getByRole('spinbutton', {
      name: '任务进度',
    })
    const submit = within(dialog).getByRole('button', { name: '提交进度' })
    const form = submit.closest('form')
    expect(form).not.toBeNull()

    await user.clear(progress)
    await user.type(progress, '70')
    fireEvent.submit(form!)
    await user.clear(progress)
    await user.type(progress, '75')
    fireEvent.submit(form!)
    await user.clear(progress)
    await user.type(progress, '80')
    fireEvent.submit(form!)

    await act(async () => {
      latestRequest.resolve({ ...submittedTask, progress: 80 })
      await latestRequest.promise
    })
    await act(async () => {
      oldSuccess.resolve({ ...submittedTask, progress: 70 })
      await oldSuccess.promise
    })
    await act(async () => {
      oldFailure.reject(new Error('旧请求迟到失败'))
      await oldFailure.promise.catch(() => undefined)
    })

    expect(progress).toHaveValue(80)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses the shared overdue status label in the progress form', () => {
    renderApp(
      <TaskInspector
        onClose={vi.fn()}
        task={task({ status: 'overdue' })}
      />,
    )

    const status = screen.getByRole('combobox', { name: '状态' })
    expect(within(status).getByRole('option', { name: '已逾期' }))
      .toBeInTheDocument()
    expect(within(status).queryByRole('option', { name: '已延期' }))
      .not.toBeInTheDocument()
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
      within(firstDialog).getByRole('textbox', { name: '进度备注' }),
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
      within(secondDialog).getByRole('textbox', { name: '进度备注' }),
    ).toHaveValue('')
  })

  it('switches the persistent form to the latest compact-list selection', async () => {
    const user = userEvent.setup()
    renderApp(<AppRoutes />, { route: '/tasks' })

    const firstTrigger = await screen.findByRole('button', {
      name: '查看 MCP 权限校验',
    })
    await user.click(firstTrigger)
    expect(screen.getByRole('region', { name: '智能任务上下文' }))
      .toHaveTextContent('MCP 权限校验')

    const latestTrigger = screen.getByRole('button', {
      name: '查看 断线恢复测试',
    })
    await user.click(latestTrigger)

    const latestContext = screen.getByRole('region', {
      name: '智能任务上下文',
    })
    expect(
      within(latestContext).getByRole('spinbutton', { name: '任务进度' }),
    ).toHaveValue(45)
    expect(latestTrigger).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('virtualizes at exactly 100 tasks but not at 99', () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      task({
        id: `threshold-${index}`,
        code: `THRESHOLD-${index}`,
        title: `阈值任务 ${index}`,
      }),
    )
    const belowThreshold = renderApp(
      <TaskTable
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={tasks.slice(0, 99)}
      />,
    )

    expect(
      belowThreshold.container.querySelector('.task-table__virtual-body'),
    ).not.toBeInTheDocument()
    belowThreshold.unmount()

    const atThreshold = renderApp(
      <TaskTable
        onSelect={vi.fn()}
        selectedTaskId={null}
        tasks={tasks}
      />,
    )
    expect(
      atThreshold.container.querySelector('.task-table__virtual-body'),
    ).toBeInTheDocument()
  })
})
