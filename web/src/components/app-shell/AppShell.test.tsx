import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { renderApp } from '../../app/test-utils'
import { AppShell } from './AppShell'

afterEach(cleanup)

describe('AppShell', () => {
  it('starts collapsed and expands the desktop sidebar on request', async () => {
    const user = userEvent.setup()

    renderApp(<AppShell />)

    const toggle = screen.getByRole('button', { name: '展开侧边栏' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('link', { name: '仪表盘' })).toHaveAttribute(
      'title',
      '仪表盘',
    )

    await user.click(toggle)

    expect(
      screen.getByRole('button', { name: '收起侧边栏' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('仪表盘')).toBeVisible()
  })

  it('exposes the primary project navigation', () => {
    renderApp(<AppShell />, { route: '/dashboard' })

    const navigation = screen.getByRole('navigation', { name: '主导航' })
    const dashboardLink = screen.getByRole('link', { name: '仪表盘' })

    expect(navigation).toBeInTheDocument()
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')
    expect(dashboardLink).toHaveClass('app-rail__link--active')
    expect(screen.getByRole('link', { name: '计划 / 任务' })).toHaveAttribute(
      'href',
      '/tasks',
    )
    expect(screen.getByRole('link', { name: '需求' })).toHaveAttribute(
      'href',
      '/requirements',
    )
    expect(screen.getByRole('link', { name: '缺陷' })).toHaveAttribute(
      'href',
      '/defects',
    )
    expect(screen.getByRole('link', { name: '项目' })).toHaveAttribute(
      'href',
      '/projects',
    )
    expect(screen.getByRole('link', { name: '负责人' })).toHaveAttribute(
      'href',
      '/actors',
    )
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('links directly to the Gantt view', () => {
    renderApp(<AppShell />)

    expect(screen.getByRole('link', { name: '甘特图' })).toHaveAttribute(
      'href',
      '/gantt',
    )
  })

  it('offers the quick submit action', () => {
    renderApp(<AppShell />)

    expect(
      screen.getByRole('button', { name: '快速提交' }),
    ).toBeInTheDocument()
  })

  it('reports that project data is stored locally', () => {
    renderApp(<AppShell />)

    expect(screen.getByText('数据已保存到本地')).toBeInTheDocument()
    expect(screen.getByText('最后更新 10:42')).toBeInTheDocument()
  })

  it('provides a stable main content target', () => {
    renderApp(<AppShell />)

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })
})
