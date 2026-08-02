import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import type { Project } from '../../data/domain'
import { projectRepository } from '../../data/query-hooks'
import baseCss from '../../styles/base.css?raw'
import responsiveCss from '../../styles/glass-responsive.css?raw'
import shellCss from '../../styles/glass-shell.css?raw'
import tokensCss from '../../styles/tokens.css?raw'
import { AppShell } from './AppShell'

function cssRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1]
    ?? ''
}

function rootHexToken(name: string): [number, number, number] {
  const root = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const value = root.match(new RegExp(`${name}:\\s*#([0-9a-f]{6})`, 'i'))
    ?.[1]
  if (!value) throw new Error(`Missing hex token ${name}`)
  return [0, 2, 4].map((offset) => Number.parseInt(
    value.slice(offset, offset + 2),
    16,
  )) as [number, number, number]
}

function mix(
  foreground: [number, number, number],
  background: [number, number, number],
  weight: number,
): [number, number, number] {
  return foreground.map((channel, index) => Math.round(
    channel * weight + background[index]! * (1 - weight),
  )) as [number, number, number]
}

function relativeLuminance([red, green, blue]: [number, number, number]) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

afterEach(cleanup)

describe('AppShell', () => {
  it('renders the approved complete desktop rail without a global header', () => {
    const { container } = renderApp(<AppShell />)

    expect(screen.getByText('Project OS')).toBeVisible()
    for (const group of ['概览', '交付', '质量', '系统']) {
      expect(screen.getByText(group)).toBeVisible()
    }
    for (const label of [
      '仪表盘',
      '项目',
      '负责人',
      '项目详情',
      '计划 / 任务',
      '甘特图',
      '需求',
      '缺陷',
      '设置',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeVisible()
    }
    expect(container.querySelectorAll('.app-rail__label')).toHaveLength(9)
    expect(screen.getByRole('region', { name: '当前工作区' })).toBeVisible()
    expect(screen.getByRole('region', { name: '当前负责人' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /(?:展开|收起)侧边栏/ }),
    ).not.toBeInTheDocument()
    expect(container.querySelector('.app-header')).not.toBeInTheDocument()
    expect(screen.queryByText('Atlas 研发平台')).not.toBeInTheDocument()
    expect(screen.queryByText('最后更新 10:42')).not.toBeInTheDocument()
  })

  it('switches the real workspace context and project-detail destination', async () => {
    const user = userEvent.setup()
    const projects = [
      {
        id: 'atlas',
        code: 'PRJ-001',
        name: 'Atlas 迁移',
        description: '核心服务迁移',
        ownerId: 'human-lin',
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
        ownerId: 'human-lin',
        startDate: null,
        dueDate: null,
        status: 'not_started',
        progress: 0,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-28T04:00:00.000Z',
        version: 1,
      },
    ] satisfies Project[]
    vi.spyOn(projectRepository, 'listProjects').mockResolvedValue(projects)

    renderApp(<AppShell />)

    const selector = await screen.findByRole('combobox', {
      name: '选择当前工作区',
    })
    await screen.findByRole('option', { name: 'Borealis 发布' })
    expect(selector).toHaveValue('atlas')
    expect(screen.getByRole('link', { name: '项目详情' })).toHaveAttribute(
      'href',
      '/projects/atlas',
    )

    await user.selectOptions(selector, 'borealis')

    expect(selector).toHaveValue('borealis')
    expect(screen.getByRole('link', { name: '项目详情' })).toHaveAttribute(
      'href',
      '/projects/borealis',
    )
    expect(sessionStorage.getItem('project-os:workspace-project'))
      .toBe('borealis')
  })

  it('uses the approved fixed desktop columns and main-content placement', () => {
    const appShellRule = cssRule(shellCss, '.app-shell')
    const railRule = cssRule(shellCss, '.app-rail')
    const mainRule = cssRule(shellCss, '.app-main')

    expect(appShellRule).toContain(
      'grid-template-columns: 220px minmax(0, 1fr)',
    )
    expect(appShellRule).not.toContain('grid-template-rows')
    expect(railRule).toContain('position: sticky')
    expect(railRule).toContain('height: 100dvh')
    expect(railRule).toContain('flex-direction: column')
    expect(mainRule).toContain('grid-column: 2')
    expect(mainRule).toContain('min-width: 0')
    expect(mainRule).toContain('padding: 28px 38px 40px')
  })

  it('keeps sticky navigation ancestors out of overflow scroll containers', () => {
    const appShellRule = cssRule(shellCss, '.app-shell')
    const htmlRule = cssRule(baseCss, 'html')
    const bodyRule = cssRule(baseCss, 'body')

    expect(appShellRule).toContain('overflow-x: clip')
    expect(appShellRule).not.toMatch(/overflow(?:-y)?:\s*(?:auto|hidden|scroll)/)
    expect(htmlRule).toContain('overflow-x: clip')
    expect(bodyRule).toContain('overflow-x: clip')
  })

  it('reserves compact rail width for locally scrollable navigation', () => {
    const navigationRule = cssRule(responsiveCss, '.app-rail__nav')

    expect(responsiveCss).toMatch(
      /\.app-rail__brand\s*\{[^}]*display:\s*none/,
    )
    expect(responsiveCss).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    )
    expect(responsiveCss).toMatch(
      /\.app-main\s*\{[^}]*grid-column:\s*1/,
    )
    expect(navigationRule).toContain('flex: 1 1 auto')
    expect(navigationRule).toContain('min-width: 0')
    expect(navigationRule).toContain('overflow-x: auto')
  })

  it('uses the semantic on-primary foreground for the brand glyph', () => {
    expect(cssRule(shellCss, '.app-rail__brand-mark')).toContain(
      'color: var(--on-primary)',
    )
  })

  it('keeps secondary text contrast on the light primary-soft surface', () => {
    const primarySoft = mix(
      rootHexToken('--primary'),
      rootHexToken('--surface'),
      0.13,
    )
    expect(
      contrastRatio(rootHexToken('--text-secondary'), primarySoft),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('uses a full accessible brand and groups navigation by workspace area', () => {
    renderApp(<AppShell />)

    expect(screen.getByRole('link', { name: 'Project OS' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(
      screen.getByRole('group', { name: '概览' }),
    ).toContainElement(screen.getByRole('link', { name: '项目' }))
    expect(
      screen.getByRole('group', { name: '交付' }),
    ).toContainElement(screen.getByRole('link', { name: '计划 / 任务' }))
    expect(
      screen.getByRole('group', { name: '质量' }),
    ).toContainElement(screen.getByRole('link', { name: '缺陷' }))
    expect(
      screen.getByRole('group', { name: '系统' }),
    ).toContainElement(screen.getByRole('link', { name: '设置' }))
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

  it('offers quick submit and restores its trigger after Escape', async () => {
    const user = userEvent.setup()
    renderApp(<AppShell />)

    const trigger = screen.getByRole('button', { name: '快速提交' })
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: '快速提交' })).toBeVisible()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('provides a skip link and stable main content target', () => {
    renderApp(<AppShell />)

    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute(
      'href',
      '#main-content',
    )
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })
})
