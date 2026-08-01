import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AppShell } from '../components/app-shell/AppShell'
import { renderApp } from './test-utils'
import { AppRoutes } from './router'

afterEach(cleanup)

const routeCases = [
  {
    eyebrow: 'PORTFOLIO OVERVIEW',
    heading: '全局驾驶舱',
    navLabel: '仪表盘',
    route: '/dashboard',
  },
  {
    eyebrow: 'PLAN / TASKS',
    heading: '任务控制台',
    navLabel: '计划 / 任务',
    route: '/tasks',
  },
  {
    eyebrow: 'PLAN / DEPENDENCY',
    heading: '甘特排程',
    navLabel: '甘特图',
    route: '/gantt',
  },
  {
    eyebrow: '计划 / 需求',
    heading: '需求管线',
    navLabel: '需求',
    route: '/requirements',
  },
  {
    eyebrow: 'QUALITY / RISK',
    heading: '缺陷矩阵',
    navLabel: '缺陷',
    route: '/defects',
  },
  {
    eyebrow: 'PROJECT MATRIX',
    heading: '全部项目',
    navLabel: '项目',
    route: '/projects',
  },
  {
    eyebrow: 'ATLAS',
    heading: 'Atlas',
    navLabel: '项目',
    route: '/projects/atlas',
  },
  {
    eyebrow: 'ACTOR NETWORK',
    heading: '负责人目录',
    navLabel: '负责人',
    route: '/actors',
  },
  {
    eyebrow: 'SETTINGS',
    heading: '设置中心',
    navLabel: '设置',
    route: '/settings',
  },
] as const

describe('AppRoutes', () => {
  it.each(routeCases)(
    'renders the $route route signature inside the active application shell',
    async ({ eyebrow, heading, navLabel, route }) => {
      renderApp(
        <AppShell>
          <AppRoutes />
        </AppShell>,
        { route },
      )

      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: heading },
          { timeout: 5_000 },
        ),
      ).toBeVisible()
      expect(screen.getByText(eyebrow, { exact: true })).toBeVisible()
      const navigation = screen.getByRole('navigation', { name: '主导航' })
      expect(within(navigation).getByRole('link', { name: navLabel })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(within(navigation).getAllByRole('link', { current: 'page' }))
        .toHaveLength(1)
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
      expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute(
        'href',
        '#main-content',
      )
    },
  )
})
