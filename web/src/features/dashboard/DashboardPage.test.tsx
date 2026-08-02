import {
  cleanup,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import { projectRepository } from '../../data/query-hooks'
import { DashboardPage } from './DashboardPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DashboardPage', () => {
  it('matches the approved compact dashboard composition', async () => {
    const { container } = renderApp(<DashboardPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: '全局驾驶舱' }),
    ).toBeVisible()
    const detail = screen.getByTestId('dashboard-detail-grid')
    expect(detail.children).toHaveLength(2)

    const ops = within(detail).getByTestId('dashboard-ops-grid')
    expect(
      within(ops).getByRole('region', { name: '风险队列' }),
    ).toBeVisible()
    expect(
      within(ops).getByRole('region', { name: '协作者状态' }),
    ).toBeVisible()
    expect(
      within(detail).getByRole('region', { name: '上下文摘要' }),
    ).toBeVisible()

    const feed = screen.getByTestId('dashboard-feed-grid')
    expect(
      within(feed).getByRole('region', { name: '最近交付物' }),
    ).toBeVisible()
    expect(
      within(feed).getByRole('region', { name: '活动流' }),
    ).toBeVisible()
    expect(container.querySelector('.dashboard-relay')).not.toBeInTheDocument()
  })

  it('uses workspace-level values for all four metrics', async () => {
    const [atlas] = await projectRepository.listProjects()
    const snapshot = await projectRepository.getWorkspaceDashboard(30)
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValueOnce([
      atlas!,
      {
        ...atlas!,
        id: 'nebula',
        code: 'NEBULA',
        name: 'Nebula',
        status: 'in_progress',
      },
      {
        ...atlas!,
        id: 'archive',
        code: 'ARCHIVE',
        name: 'Archive',
        status: 'completed',
      },
    ])
    vi.spyOn(projectRepository, 'getWorkspaceDashboard').mockResolvedValueOnce({
      ...snapshot,
      metrics: { ...snapshot.metrics, activeActors: 9, activeAgents: 4 },
      risks: [
        ...snapshot.risks,
        { ...snapshot.risks[0]!, id: 'risk-workspace-extra' },
      ],
    })

    renderApp(<DashboardPage />)

    const metrics = await screen.findByRole('group', {
      name: '全局驾驶舱关键指标',
    })
    const metric = (label: string) =>
      within(metrics).getByText(label).closest('article')!
    expect(within(metric('项目总数')).getByText('3')).toBeVisible()
    expect(within(metric('活跃项目')).getByText('2')).toBeVisible()
    expect(within(metric('组合开放风险')).getByText('3')).toBeVisible()
    expect(within(metric('活跃协作者')).getByText('9')).toBeVisible()
    expect(within(metrics).queryByText(/当前项目/)).not.toBeInTheDocument()
  })

  it('defaults to the highest risk and shares one context between risks and actors', async () => {
    const user = userEvent.setup()
    const baseline = await projectRepository.getWorkspaceDashboard(30)
    vi.spyOn(projectRepository, 'getWorkspaceDashboard').mockResolvedValueOnce({
      ...baseline,
      risks: [...baseline.risks].reverse(),
    })

    renderApp(<DashboardPage />)

    const context = await screen.findByRole('region', { name: '上下文摘要' })
    expect(within(context).getByText('断线恢复测试')).toBeVisible()
    expect(within(context).getByText('风险级别')).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: '选择协作者：dev-agent' }),
    )
    expect(within(context).getByText('dev-agent')).toBeVisible()
    expect(within(context).getByText('工作负载')).toBeVisible()
    expect(within(context).getByText('2 个认领任务')).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: '选择风险：甘特图渲染' }),
    )
    expect(within(context).getByText('甘特图渲染')).toBeVisible()
    expect(within(context).getAllByText('预警')).toHaveLength(2)
  })

  it('falls back to the first active actor when there are no risks', async () => {
    const snapshot = await projectRepository.getWorkspaceDashboard(30)
    vi.spyOn(projectRepository, 'getWorkspaceDashboard').mockResolvedValueOnce({
      ...snapshot,
      risks: [],
    })

    renderApp(<DashboardPage />)

    const context = await screen.findByRole('region', { name: '上下文摘要' })
    expect(within(context).getByText('dev-agent')).toBeVisible()
    expect(within(context).getByText('工作负载')).toBeVisible()
    expect(screen.getByRole('region', { name: '项目指标' })).toBeVisible()
  })

  it('deduplicates actor sessions and selects the latest active representative', async () => {
    const snapshot = await projectRepository.getWorkspaceDashboard(30)
    const sessions = await projectRepository.listProjectSessions('atlas')
    const active = sessions.find(({ status }) => status === 'active')!
    const abandoned = sessions.find(({ status }) => status === 'abandoned')!
    vi.spyOn(projectRepository, 'getWorkspaceDashboard').mockResolvedValueOnce({
      ...snapshot,
      risks: [],
    })
    vi.spyOn(projectRepository, 'listProjectSessions').mockResolvedValueOnce([
      {
        ...active,
        id: 'session-dev-abandoned-newest',
        intent: '不应作为代表的离场会话',
        status: 'abandoned',
        taskIds: ['wrong-abandoned'],
        lastActiveAt: '2026-07-29T04:10:00.000Z',
      },
      active,
      {
        ...active,
        id: 'session-dev-active-latest',
        intent: '最新活跃会话',
        taskIds: ['task-a', 'task-b', 'task-c'],
        lastActiveAt: '2026-07-29T03:10:00.000Z',
      },
      abandoned,
    ])

    renderApp(<DashboardPage />)

    const presence = await screen.findByRole('region', { name: '协作者状态' })
    expect(
      within(presence).getAllByRole('button', {
        name: '选择协作者：dev-agent',
      }),
    ).toHaveLength(1)
    expect(within(presence).getByText('1 个活跃')).toBeVisible()
    expect(within(presence).getByText('最新活跃会话')).toBeVisible()
    const context = screen.getByRole('region', { name: '上下文摘要' })
    expect(within(context).getByText('3 个认领任务')).toBeVisible()
    expect(within(context).getByText('最新活跃会话')).toBeVisible()
  })

  it('labels project-scoped presence and deliverables with the current project', async () => {
    renderApp(<DashboardPage />)

    const presence = await screen.findByRole('region', { name: '协作者状态' })
    const deliverables = screen.getByRole('region', { name: '最近交付物' })
    expect(within(presence).getByText('Atlas · 当前项目')).toBeVisible()
    expect(within(deliverables).getByText('Atlas · 当前项目')).toBeVisible()
  })

  it('exposes the dates, actuals and plans behind the compact trend graphic', async () => {
    renderApp(<DashboardPage />)

    const trend = await screen.findByRole('img', {
      name: /06\/30 实际 3，计划 4/,
    })
    expect(trend).toHaveAccessibleName(/07\/28 实际 34，计划 40/)
  })

  it('re-resolves the shared context when the dashboard snapshot changes', async () => {
    const user = userEvent.setup()
    const baseline = await projectRepository.getWorkspaceDashboard(30)
    const selected = baseline.risks.find(({ level }) => level === 'critical')!
    vi.spyOn(projectRepository, 'getWorkspaceDashboard').mockImplementation(
      async (days = 30) => {
        if (days === 7) {
          return {
            ...baseline,
            risks: [{
              ...selected,
              title: '更新后的断线恢复风险',
              dueDate: '2026-08-02',
            }],
            trend: [{ date: '2026-08-01', actual: 70, planned: 72 }],
          }
        }
        if (days === 90) {
          return {
            ...baseline,
            risks: [],
            trend: [{ date: '2026-08-01', actual: 90, planned: 92 }],
          }
        }
        return baseline
      },
    )

    renderApp(<DashboardPage />)
    await screen.findByRole('region', { name: '上下文摘要' })
    await user.click(screen.getByRole('button', { name: '7 天' }))
    const updatedContext = await screen.findByRole('region', {
      name: '上下文摘要',
    })
    expect(await within(updatedContext).findByText('更新后的断线恢复风险'))
      .toBeVisible()

    await user.click(screen.getByRole('button', { name: '90 天' }))
    const actorContext = await screen.findByRole('region', {
      name: '上下文摘要',
    })
    await waitFor(() => {
      expect(within(actorContext).getByText('dev-agent')).toBeVisible()
      expect(within(actorContext).getByText('工作负载')).toBeVisible()
    })
  })

  it('keeps the health signature honest when the portfolio is empty', async () => {
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue([])

    renderApp(<DashboardPage />)

    expect(await screen.findByText('暂无项目组合数据')).toBeVisible()
    expect(
      screen.getByText('创建项目后，这里会展示真实项目进度。'),
    ).toBeVisible()
  })

  it('shows the project query error instead of a partial global overview', async () => {
    vi.spyOn(projectRepository, 'listProjects').mockRejectedValue(
      new Error('项目组合不可用'),
    )

    renderApp(<DashboardPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('项目组合不可用')
    expect(
      screen.queryByRole('heading', { level: 1, name: '全局驾驶舱' }),
    ).not.toBeInTheDocument()
  })

  it('loads the selected 90-day period', async () => {
    const user = userEvent.setup()
    renderApp(<DashboardPage />)

    expect(
      await screen.findByRole('button', { name: '30 天' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '90 天' }))

    expect(
      screen.getByRole('button', { name: '90 天' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('118 项已完成')).toBeVisible()
  })

  it('shows an alert when the dashboard query fails', async () => {
    vi.spyOn(projectRepository, 'getWorkspaceDashboard').mockRejectedValueOnce(
      new Error('数据库文件不可访问'),
    )

    renderApp(<DashboardPage />)

    expect(
      await screen.findByRole('heading', { name: '无法读取本地项目数据' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '数据库文件不可访问',
    )
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
  })
})
