import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import type { Actor, Project, Task } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import { ProjectPage } from './ProjectPage'

const actors: Actor[] = [
  {
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
  },
  {
    id: 'owner-inactive',
    name: 'Maya',
    kind: 'human',
    role: 'owner',
    status: 'inactive',
    client: null,
    capabilities: [],
    registeredAt: '2026-07-01T00:00:00.000Z',
    lastActiveAt: null,
    version: 1,
  },
]

const projects: Project[] = [
  {
    id: 'atlas',
    code: 'PRJ-001',
    name: 'Atlas 迁移',
    description: '核心服务迁移',
    ownerId: 'owner-active',
    startDate: '2026-07-01',
    dueDate: '2026-07-28',
    status: 'in_progress',
    progress: 62,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-28T04:00:00.000Z',
    version: 1,
  },
  {
    id: 'borealis',
    code: 'PRJ-002',
    name: 'Borealis 发布',
    description: '',
    ownerId: 'owner-inactive',
    startDate: null,
    dueDate: null,
    status: 'not_started',
    progress: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-28T04:00:00.000Z',
    version: 1,
  },
]

afterEach(cleanup)

function mockPortfolio() {
  vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
  vi.spyOn(projectRepository, 'listProjects').mockResolvedValue(projects)
  vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue([])
}

function ProjectPageWithNavigationState({ state }: { state: unknown }) {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname === '/notice-setup') {
      navigate('/projects?owner=owner-active', { replace: true, state })
    }
  }, [location.pathname, navigate, state])

  return location.pathname === '/projects' ? <ProjectPage /> : null
}

describe('ProjectPage', () => {
  it('consumes a valid deletion notice once while preserving the current render', async () => {
    mockPortfolio()
    const notice = `已永久删除项目 ${projects[0]!.name}`

    renderApp(<ProjectPageWithNavigationState state={{ projectNotice: notice }} />, {
      route: '/notice-setup',
    })

    const renderedNotice = await screen.findByText(notice)
    expect(renderedNotice).toHaveAttribute('role', 'status')
    expect(window.location.pathname).toBe('/projects')
    expect(window.location.search).toBe('?owner=owner-active')
    expect(window.history.state.usr).toBeNull()
    expect(renderedNotice).toHaveTextContent(notice)
  })

  it.each([
    ['non-string', { projectNotice: { text: '伪造消息' } }],
    ['unexpected message', { projectNotice: '<script>alert(1)</script>' }],
    [
      'prefixed markup',
      { projectNotice: '已永久删除项目 <img src=x onerror=alert(1)>' },
    ],
    ['unrelated state', { anotherKey: '已永久删除项目 Atlas' }],
  ])('does not render a %s project notice', async (_, state) => {
    mockPortfolio()
    renderApp(<ProjectPageWithNavigationState state={state} />, {
      route: '/notice-setup',
    })

    await screen.findByRole('article', { name: projects[0]!.name })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows honest portfolio metrics and filters the matrix by derived health', async () => {
    const user = userEvent.setup()
    const today = new Date()
    today.setUTCDate(today.getUTCDate() + 3)
    const attentionProject: Project = {
      ...projects[0]!,
      id: 'calypso',
      code: 'PRJ-003',
      name: 'Calypso 验收',
      dueDate: today.toISOString().slice(0, 10),
      progress: 35,
    }
    vi.spyOn(projectRepository, 'listActors').mockResolvedValue(actors)
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue([
      projects[0]!,
      attentionProject,
      projects[1]!,
    ])
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue([])

    renderApp(<ProjectPage />, { route: '/projects' })

    const metrics = await screen.findByRole('group', {
      name: '项目组合关键指标',
    })
    expect(within(within(metrics).getByText('项目总数').closest('article')!)
      .getByText('3')).toBeVisible()
    expect(within(within(metrics).getByText('正常').closest('article')!)
      .getByText('1')).toBeVisible()
    expect(within(within(metrics).getByText('需关注').closest('article')!)
      .getByText('1')).toBeVisible()
    expect(within(within(metrics).getByText('高风险').closest('article')!)
      .getByText('1')).toBeVisible()

    const healthFilters = screen.getByRole('group', {
      name: '项目健康筛选',
    })
    const riskFilter = within(healthFilters).getByRole('button', {
      name: '高风险',
    })
    expect(within(healthFilters).getByRole('button', { name: '全部' }))
      .toHaveAttribute('aria-pressed', 'true')

    await user.click(riskFilter)

    expect(riskFilter).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('article', { name: 'Atlas 迁移' })).toBeVisible()
    expect(screen.queryByRole('article', { name: 'Calypso 验收' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Borealis 发布' }))
      .not.toBeInTheDocument()
  })

  it('selects the first visible project by default and falls back after filtering', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    renderApp(<ProjectPage />, { route: '/projects' })

    const atlas = await screen.findByRole('article', { name: 'Atlas 迁移' })
    expect(within(atlas).getByRole('button', {
      name: '查看 Atlas 迁移 摘要',
    })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Atlas 迁移项目摘要' }))
      .toBeVisible()

    await user.click(screen.getByRole('button', { name: '正常' }))

    const borealis = screen.getByRole('article', { name: 'Borealis 发布' })
    expect(within(borealis).getByRole('button', {
      name: '查看 Borealis 发布 摘要',
    })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Borealis 发布项目摘要' }))
      .toBeVisible()
    expect(within(borealis).getByRole('link', {
      name: '进入 Borealis 发布 详情',
    })).toHaveAttribute('href', '/projects/borealis')
    expect(window.location.pathname).toBe('/projects')
  })

  it('keeps health controls available when a filter has zero results', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    renderApp(<ProjectPage />, { route: '/projects' })

    const filters = await screen.findByRole('group', {
      name: '项目健康筛选',
    })
    await user.click(within(filters).getByRole('button', { name: '关注' }))

    expect(screen.getByText('没有符合当前筛选条件的项目')).toBeVisible()
    expect(screen.getByRole('group', { name: '项目健康筛选' })).toBeVisible()

    await user.click(within(filters).getByRole('button', { name: '全部' }))

    expect(screen.getByRole('article', { name: 'Atlas 迁移' })).toBeVisible()
    expect(screen.getByRole('article', { name: 'Borealis 发布' })).toBeVisible()
  })

  it('selects an evidence-based summary without navigating and keeps a real detail link', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    vi.mocked(projectRepository.listAllTasks).mockResolvedValue([
      {
        id: 'atlas-overdue',
        code: 'TASK-011',
        projectId: 'atlas',
        title: '补齐回滚证据',
        description: '',
        assignee: actors[0]!,
        assigneeId: actors[0]!.id,
        startDate: '2026-07-10',
        dueDate: '2026-07-20',
        priority: 'P0',
        status: 'overdue',
        progress: 40,
        milestoneId: 'release',
        dependencyIds: [],
      },
      {
        id: 'atlas-next',
        code: 'TASK-012',
        projectId: 'atlas',
        title: '发布复核',
        description: '',
        assignee: actors[0]!,
        assigneeId: actors[0]!.id,
        startDate: '2026-07-21',
        dueDate: '2026-08-04',
        priority: 'P1',
        status: 'in_progress',
        progress: 60,
        milestoneId: 'release',
        dependencyIds: [],
      },
    ])
    renderApp(<ProjectPage />, { route: '/projects' })

    const atlas = await screen.findByRole('article', { name: 'Atlas 迁移' })
    const summaryButton = within(atlas).getByRole('button', {
      name: '查看 Atlas 迁移 摘要',
    })
    const detailLink = within(atlas).getByRole('link', {
      name: '进入 Atlas 迁移 详情',
    })
    expect(detailLink).toHaveAttribute('href', '/projects/atlas')

    await user.click(summaryButton)

    expect(window.location.pathname).toBe('/projects')
    expect(summaryButton).toHaveAttribute('aria-pressed', 'true')
    const summary = screen.getByRole('region', {
      name: 'Atlas 迁移项目摘要',
    })
    expect(within(summary).getByText('Lin')).toBeVisible()
    expect(
      within(within(summary).getByText('当前状态').parentElement!)
        .getByText('进行中'),
    ).toBeVisible()
    expect(within(summary).getByText('62%')).toBeVisible()
    expect(within(summary).getByText('1 项逾期')).toBeVisible()
    expect(within(summary).getByText('2026-07-20')).toBeVisible()
  })

  it('renders actual portfolio fields and real grouped task counts', async () => {
    mockPortfolio()
    vi.mocked(projectRepository.listAllTasks).mockResolvedValue([
      { projectId: 'atlas' },
      { projectId: 'atlas' },
      { projectId: 'borealis' },
    ] as Task[])
    renderApp(<ProjectPage />)

    expect(screen.getByRole('heading', { name: '全部项目' })).toBeVisible()
    const atlas = await screen.findByRole('article', { name: 'Atlas 迁移' })
    expect(within(atlas).getByText('PRJ-001')).toBeVisible()
    expect(within(atlas).getByText('主要负责人')).toBeVisible()
    expect(within(atlas).getByText('Lin')).toBeVisible()
    expect(within(atlas).getByText('进行中')).toBeVisible()
    expect(within(atlas).getByText('62%')).toBeVisible()
    expect(within(atlas).getByText('已逾期')).toBeVisible()
    expect(within(atlas).getByRole('link')).toHaveAttribute(
      'href',
      '/projects/atlas',
    )
    expect(within(atlas).getByText('2')).toBeVisible()
    expect(
      within(screen.getByRole('article', { name: 'Borealis 发布' }))
        .getByText('1'),
    ).toBeVisible()
  })

  it('orders overdue and near-due projects before normal projects', async () => {
    mockPortfolio()
    vi.mocked(projectRepository.listProjects).mockResolvedValue([
      projects[1]!,
      {
        ...projects[0]!,
        id: 'normal',
        name: 'Normal',
        dueDate: '2026-09-01',
      },
      {
        ...projects[0]!,
        id: 'near',
        name: 'Near',
        dueDate: '2026-08-01',
      },
      projects[0]!,
    ])
    renderApp(<ProjectPage />)

    const matrix = await screen.findByRole('region', { name: '玻璃项目矩阵' })
    expect(
      within(matrix).getAllByRole('article').map(
        (article) => article.getAttribute('aria-label'),
      ),
    ).toEqual(['Atlas 迁移', 'Near', 'Normal', 'Borealis 发布'])
  })

  it('shows the initial error when actors fail after projects load', async () => {
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue(projects)
    vi.spyOn(projectRepository, 'listActors').mockRejectedValue(
      new Error('负责人服务不可用'),
    )
    vi.spyOn(projectRepository, 'listAllTasks').mockResolvedValue([])
    renderApp(<ProjectPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '负责人服务不可用',
    )
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('keeps stale cards visible when an actor refetch fails', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    vi.mocked(projectRepository.listActors)
      .mockResolvedValueOnce(actors)
      .mockRejectedValueOnce(new Error('负责人刷新失败'))
    vi.spyOn(projectRepository, 'createProject').mockResolvedValue({
      ...projects[0]!,
      id: 'new-project',
      code: 'PRJ-003',
      name: '触发刷新',
    })
    renderApp(<ProjectPage />)
    expect(await screen.findByRole('article', { name: 'Atlas 迁移' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '新建项目' }))
    const dialog = screen.getByRole('dialog', { name: '新建项目' })
    await user.type(within(dialog).getByLabelText('项目名称'), '触发刷新')
    await user.selectOptions(
      within(dialog).getByLabelText('主要负责人'),
      'owner-active',
    )
    await user.click(within(dialog).getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('负责人刷新失败')
    expect(screen.getByRole('article', { name: 'Atlas 迁移' })).toBeVisible()
  })

  it('hydrates owner and search filters from the URL and writes changes back', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    renderApp(<ProjectPage />, {
      route: '/projects?owner=owner-active&q=Atlas',
    })

    expect(await screen.findByRole('article', { name: 'Atlas 迁移' })).toBeVisible()
    expect(
      screen.queryByRole('article', { name: 'Borealis 发布' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.clear(screen.getByRole('searchbox', { name: '搜索项目' }))
    await user.click(screen.getByRole('button', { name: '全部负责人' }))

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('article', { name: 'Borealis 发布' })).toBeVisible()
  })

  it('validates and creates a project with nullable dates', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    const createProject = vi.spyOn(projectRepository, 'createProject')
      .mockResolvedValue({
        ...projects[0]!,
        id: 'new-project',
        code: 'PRJ-003',
        name: '新项目',
        description: '范围说明',
        startDate: null,
        dueDate: null,
      })
    renderApp(<ProjectPage />)

    await user.click(await screen.findByRole('button', { name: '新建项目' }))
    const dialog = screen.getByRole('dialog', { name: '新建项目' })
    await user.click(within(dialog).getByRole('button', { name: '创建项目' }))
    expect(within(dialog).getByText('请输入项目名称')).toBeVisible()
    expect(within(dialog).getByText('请选择有效负责人')).toBeVisible()

    await user.type(within(dialog).getByLabelText('项目名称'), '新项目')
    await user.selectOptions(
      within(dialog).getByLabelText('主要负责人'),
      'owner-active',
    )
    await user.type(within(dialog).getByLabelText('项目描述'), '范围说明')
    await user.click(within(dialog).getByRole('button', { name: '创建项目' }))

    expect(createProject).toHaveBeenCalledWith({
      name: '新项目',
      ownerId: 'owner-active',
      description: '范围说明',
      startDate: null,
      dueDate: null,
    })
  })

  it('keeps entered values and reports repository failures', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    vi.spyOn(projectRepository, 'createProject').mockRejectedValue(
      new Error('项目服务不可用'),
    )
    renderApp(<ProjectPage />)

    await user.click(await screen.findByRole('button', { name: '新建项目' }))
    const dialog = screen.getByRole('dialog', { name: '新建项目' })
    await user.type(within(dialog).getByLabelText('项目名称'), '保留项目')
    await user.selectOptions(
      within(dialog).getByLabelText('主要负责人'),
      'owner-active',
    )
    await user.type(within(dialog).getByLabelText('开始日期'), '2026-08-10')
    await user.type(within(dialog).getByLabelText('截止日期'), '2026-08-01')
    await user.click(within(dialog).getByRole('button', { name: '创建项目' }))
    expect(within(dialog).getByText('开始日期不能晚于截止日期')).toBeVisible()

    await user.clear(within(dialog).getByLabelText('截止日期'))
    await user.type(within(dialog).getByLabelText('截止日期'), '2026-08-20')
    await user.click(within(dialog).getByRole('button', { name: '创建项目' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '项目服务不可用',
    )
    expect(within(dialog).getByLabelText('项目名称')).toHaveValue('保留项目')
    expect(within(dialog).getByLabelText('开始日期')).toHaveValue('2026-08-10')
  })

  it('traps focus, closes on Escape, and restores focus to its opener', async () => {
    const user = userEvent.setup()
    mockPortfolio()
    renderApp(<ProjectPage />)
    const opener = await screen.findByRole('button', { name: '新建项目' })

    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: '新建项目' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const close = within(dialog).getByRole('button', { name: '关闭新建项目' })
    const submit = within(dialog).getByRole('button', { name: '创建项目' })
    close.focus()
    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
