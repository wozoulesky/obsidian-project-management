import { cleanup, screen, within } from '@testing-library/react'
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
  it('shows the default project health, highest risk and responsible agent', async () => {
    renderApp(<DashboardPage />)

    const metrics = await screen.findByRole('region', {
      name: '项目指标',
    })
    expect(within(metrics).getByText('68%')).toBeInTheDocument()
    const riskTable = screen.getByRole('table', { name: '风险队列' })
    expect(within(riskTable).getByText('断线恢复测试')).toBeInTheDocument()
    expect(within(riskTable).getByText('dev-agent')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '30 天' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('loads the selected 90-day period and reports its latest completed total', async () => {
    const user = userEvent.setup()
    renderApp(<DashboardPage />)

    const metrics = await screen.findByRole('region', {
      name: '项目指标',
    })
    expect(within(metrics).getByText('68%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '90 天' }))

    expect(
      screen.getByRole('button', { name: '90 天' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: '30 天' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText('118 项已完成')).toBeInTheDocument()
  })

  it('opens a keyboard-reachable risk inspector from the queue', async () => {
    const user = userEvent.setup()
    renderApp(<DashboardPage />)

    const riskButton = await screen.findByRole('button', {
      name: '查看风险：断线恢复测试',
    })
    await user.click(riskButton)

    const inspector = screen.getByRole('complementary', {
      name: '风险详情',
    })
    expect(within(inspector).getByText('断线恢复测试')).toBeInTheDocument()
    expect(within(inspector).getByText('2026-07-26')).toBeInTheDocument()
  })

  it('shows an alert when the dashboard query fails', async () => {
    vi.spyOn(projectRepository, 'getDashboard').mockRejectedValueOnce(
      new Error('fixture failure'),
    )

    renderApp(<DashboardPage />)

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('项目健康数据加载失败，请稍后重试。')
  })
})
