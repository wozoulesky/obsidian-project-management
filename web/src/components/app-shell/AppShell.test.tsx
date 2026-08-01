import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { renderApp } from '../../app/test-utils'
import baseCss from '../../styles/base.css?raw'
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
  it('starts collapsed and expands the desktop sidebar on request', async () => {
    const user = userEvent.setup()

    const { container } = renderApp(<AppShell />)

    const toggle = screen.getByRole('button', { name: '展开侧边栏' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelectorAll('.app-rail__label')).toHaveLength(0)
    expect(screen.getByRole('link', { name: '仪表盘' })).toHaveAttribute(
      'title',
      '仪表盘',
    )

    await user.click(toggle)

    expect(
      screen.getByRole('button', { name: '收起侧边栏' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('仪表盘')).toBeVisible()
    expect(screen.getByText('Project OS')).toBeVisible()
    expect(screen.getByText('概览')).toBeVisible()
    expect(screen.getByText('交付')).toBeVisible()
    expect(screen.getByText('质量')).toBeVisible()
    expect(screen.getByText('系统')).toBeVisible()
    expect(container.querySelectorAll('.app-rail__label')).toHaveLength(8)
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

  it('reports that the workspace is offline and project data is local', () => {
    renderApp(<AppShell />)

    expect(screen.getByText('OFFLINE / LOCAL')).toBeInTheDocument()
    expect(screen.getByText('数据已保存到本地')).toBeInTheDocument()
    expect(screen.getByText('最后更新 10:42')).toBeInTheDocument()
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
