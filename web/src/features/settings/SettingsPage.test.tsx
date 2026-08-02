import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import { projectRepository } from '../../data/query-hooks'
import { SettingsPage } from './SettingsPage'
import settingsGlassCss from './settings-glass.css?raw'

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const attribute of [
      'data-theme',
      'data-background',
      'data-accent',
      'data-density',
    ]) {
      document.documentElement.removeAttribute(attribute)
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows one active panel whose primary heading follows the selected tab', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    const navigation = await screen.findByRole('tablist', {
      name: '设置分类',
    })
    for (const name of ['外观', '数据', 'MCP', 'Skills']) {
      await user.click(within(navigation).getByRole('tab', { name }))
      const visiblePanels = screen.getAllByRole('tabpanel')
      expect(visiblePanels).toHaveLength(1)
      expect(visiblePanels[0]).toHaveClass(
        'settings-page__panel',
        'settings-page__panel--active',
      )
      expect(within(visiblePanels[0]!).getByRole('heading', {
        level: 2,
        name,
      })).toBeVisible()
      expect(
        visiblePanels[0]!.querySelector('.settings-panel-heading__meta'),
      ).toBeInTheDocument()
    }
  })

  it('uses a compact desktop stage, two-column controls, and mobile tabs', async () => {
    renderApp(<SettingsPage />)

    const appearancePanel = await screen.findByRole('tabpanel', {
      name: '外观',
    })
    expect(appearancePanel.querySelectorAll('.settings-control-row'))
      .toHaveLength(4)
    expect(appearancePanel.querySelector('.settings-control-grid'))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /快照/ }))
      .not.toBeInTheDocument()

    expect(settingsGlassCss).toMatch(
      /\.settings-page__panel\s*{[^}]*min-height:\s*27rem/s,
    )
    expect(settingsGlassCss).toMatch(
      /\.settings-control-grid\s*{[^}]*grid-template-columns:\s*repeat\(2,/s,
    )
    expect(settingsGlassCss).toMatch(
      /\.settings-actions\s*{[^}]*justify-content:\s*flex-end/s,
    )
    expect(settingsGlassCss).toMatch(
      /@media \(width <= 48rem\)[\s\S]*\.settings-category-nav\s*{[^}]*overflow-x:\s*auto/s,
    )
    expect(settingsGlassCss).toMatch(
      /@media \(width <= 48rem\)[\s\S]*\.settings-control-grid\s*{[^}]*grid-template-columns:\s*1fr/s,
    )
  })

  it('treats the exact 48rem boundary as mobile in CSS and keyboard semantics', async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(max-width: 48rem)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList)
    vi.stubGlobal('matchMedia', matchMedia)

    renderApp(<SettingsPage />)

    expect(await screen.findByRole('tablist', { name: '设置分类' }))
      .toHaveAttribute('aria-orientation', 'horizontal')
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 48rem)')
    expect(settingsGlassCss).toContain('@media (width <= 48rem)')
  })

  it('keeps secondary MCP and Skills tools collapsed by default', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'MCP' }))
    const tokenHistory = screen.getByRole('group', {
      name: '已签发令牌',
    })
    expect(tokenHistory).not.toHaveAttribute('open')

    await user.click(screen.getByRole('tab', { name: 'Skills' }))
    const moreClients = screen.getByRole('group', {
      name: '更多客户端配置',
    })
    expect(moreClients).not.toHaveAttribute('open')
  })

  it('keeps every category panel mounted and links each tab to a stable panel', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    const navigation = await screen.findByRole('tablist', {
      name: '设置分类',
    })
    const tabs = within(navigation).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent))
      .toEqual(['外观', '数据', 'MCP', 'Skills'])
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(4)

    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId).toBeTruthy()
      expect(document.getElementById(panelId!)).toHaveAttribute('role', 'tabpanel')
    }

    expect(document.getElementById('settings-panel-appearance'))
      .not.toHaveAttribute('hidden')
    expect(document.getElementById('settings-panel-data')).toHaveAttribute('hidden')
    expect(document.getElementById('settings-panel-mcp')).toHaveAttribute('hidden')
    expect(document.getElementById('settings-panel-skills')).toHaveAttribute('hidden')
    const inactiveMcpPanel = document.getElementById('settings-panel-mcp')!
    expect(within(inactiveMcpPanel).queryAllByRole('button')).toHaveLength(0)
    expect(
      within(inactiveMcpPanel).getAllByRole('button', { hidden: true }).length,
    ).toBeGreaterThan(0)

    await user.click(within(navigation).getByRole('tab', { name: '数据' }))
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(4)
    expect(document.getElementById('settings-panel-appearance')).toHaveAttribute('hidden')
    expect(document.getElementById('settings-panel-data'))
      .not.toHaveAttribute('hidden')
    expect(screen.getByRole('heading', { name: '常规' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '数据' })).toBeVisible()
    expect(
      within(document.getElementById('settings-panel-appearance')!).getByRole(
        'heading',
        { hidden: true, name: '外观' },
      ),
    ).toBeInTheDocument()
  })

  it('supports roving keyboard focus and activates the focused category', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    const appearance = await screen.findByRole('tab', { name: '外观' })
    appearance.focus()
    await user.keyboard('{ArrowDown}')

    const data = screen.getByRole('tab', { name: '数据' })
    expect(data).toHaveFocus()
    expect(data).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '数据' })).toBeVisible()
  })

  it('matches tablist orientation and arrow keys to responsive layout changes', async () => {
    const user = userEvent.setup()
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    let matches = false
    const media = '(max-width: 48rem)'
    const mediaQueryList = {
      get matches() {
        return matches
      },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQueryList))

    renderApp(<SettingsPage />)

    const navigation = await screen.findByRole('tablist', { name: '设置分类' })
    const tabs = within(navigation).getAllByRole('tab')
    expect(navigation).toHaveAttribute('aria-orientation', 'vertical')

    act(() => {
      matches = true
      const event = { matches, media } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    })

    expect(navigation).toHaveAttribute('aria-orientation', 'horizontal')
    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')

    act(() => {
      matches = false
      const event = { matches, media } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    })

    expect(navigation).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('previews presets immediately and explicitly saves the current version', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('radio', { name: '深色' }))
    await user.click(screen.getByRole('radio', { name: '紫色' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-accent', 'purple')
    expect(localStorage.getItem('project-os:appearance')).toContain('purple')

    await user.click(screen.getByRole('button', { name: '保存外观设置' }))
    expect(await screen.findByRole('status')).toHaveTextContent('外观设置已保存')
  })

  it('applies valid local presets synchronously before API reconciliation', () => {
    localStorage.setItem('project-os:appearance', JSON.stringify({
      theme: 'dark',
      background: 'gradient',
      accent: 'orange',
      density: 'compact',
    }))

    renderApp(<SettingsPage />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute(
      'data-background',
      'gradient',
    )
    expect(document.documentElement).toHaveAttribute('data-accent', 'orange')
    expect(document.documentElement).toHaveAttribute('data-density', 'compact')
  })

  it('preserves the preview and local value when an explicit save conflicts', async () => {
    const user = userEvent.setup()
    vi.spyOn(projectRepository, 'updateSettings').mockRejectedValue(
      new Error('Settings version is stale'),
    )
    renderApp(<SettingsPage />)

    const dark = await screen.findByRole('radio', { name: '深色' })
    await user.click(dark)
    await user.click(screen.getByRole('button', { name: '保存外观设置' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Settings version is stale',
    )
    expect(dark).toBeChecked()
    expect(localStorage.getItem('project-os:appearance')).toContain('dark')
  })

  it('creates a backup and only restores the safe filename it just created', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: '数据' }))

    const dataSection = (await screen.findByRole('heading', { name: '数据' }))
      .closest('section')
    if (!dataSection) throw new Error('Expected data settings section')

    await user.click(within(dataSection).getByRole('button', {
      name: '创建备份',
    }))
    const backupFilename = (await within(dataSection).findByText(
      /project-os-test-\d+\.sqlite/,
      { selector: 'code' },
    )).textContent

    await user.click(screen.getByRole('tab', { name: '外观' }))
    expect(document.getElementById('settings-panel-data')).toHaveAttribute('hidden')
    await user.click(screen.getByRole('tab', { name: '数据' }))

    expect(within(dataSection).getByText(backupFilename!)).toBeVisible()
    expect(within(dataSection).getByRole('button', {
      name: '恢复此备份',
    })).toBeEnabled()

    await user.click(within(dataSection).getByRole('button', {
      name: '恢复此备份',
    }))
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining(backupFilename!),
    )
    expect(await within(dataSection).findByRole('status'))
      .toHaveTextContent('备份已恢复')
  })

  it('imports JSON within the API limit and reports all returned counts', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: '数据' }))

    await user.upload(
      await screen.findByLabelText('选择要导入的 JSON 文件'),
      new File(['{}'], 'project-os.json', { type: 'application/json' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      /负责人 6，项目 1，成员关系 6，任务 50，需求 20，缺陷 7，会话 2，交接 1，交付物 1/,
    )
  })

  it('shows an issued token once and never stores the secret', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'MCP' }))

    expect(screen.getByText('http://127.0.0.1:4310/mcp')).toBeVisible()
    expect(screen.queryByText(/5173\/mcp/)).not.toBeInTheDocument()

    await user.type(await screen.findByLabelText('令牌名称'), 'local-codex')
    await user.click(screen.getByRole('button', { name: '签发令牌' }))

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('仅显示一次')
    const token = within(warning).getByText(/^pos_/).textContent
    expect(token).toBeTruthy()
    expect(localStorage.getItem('project-os:appearance')).not.toContain('pos_')

    await user.click(screen.getByRole('tab', { name: '数据' }))
    expect(document.getElementById('settings-panel-mcp')).toHaveAttribute('hidden')
    await user.click(screen.getByRole('tab', { name: 'MCP' }))

    expect(screen.getByRole('alert')).toHaveTextContent('仅显示一次')
    expect(screen.getByText(token!)).toBeVisible()

    await user.click(within(warning).getByRole('button', {
      name: '复制令牌',
    }))
    expect(writeText).toHaveBeenCalledWith(token)
    await user.click(within(warning).getByRole('button', {
      name: '我已保存，隐藏令牌',
    }))
    expect(screen.queryByText(token!)).not.toBeInTheDocument()
  })

  it('settles an issued-token request while its mounted panel is hidden', async () => {
    const user = userEvent.setup()
    const originalIssueToken = projectRepository.issueToken.bind(projectRepository)
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    vi.spyOn(projectRepository, 'issueToken').mockImplementationOnce(async (name) => {
      await requestGate
      return originalIssueToken(name)
    })
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'MCP' }))
    await user.type(screen.getByLabelText('令牌名称'), 'pending-codex')
    await user.click(screen.getByRole('button', { name: '签发令牌' }))
    expect(screen.getByRole('button', { name: '签发令牌' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: '数据' }))
    expect(document.getElementById('settings-panel-mcp')).toHaveAttribute('hidden')

    await act(async () => {
      releaseRequest()
      await requestGate
    })

    await user.click(screen.getByRole('tab', { name: 'MCP' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('仅显示一次')
    expect(screen.getByText(/^pos_/)).toBeVisible()
  })

  it('loads and copies server-generated stdio client snippets', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    projectRepository.getSkillConfigSnippet = vi.fn(async (client) => ({
      client,
      transport: 'stdio' as const,
      snippet: `${client}: server-generated stdio configuration`,
    }))
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'Skills' }))

    const skillSection = (await screen.findByRole('heading', {
      name: 'Agent Skills',
    })).closest('section')
    if (!skillSection) throw new Error('Expected Skill settings section')
    await within(skillSection).findByText(
      'codex: server-generated stdio configuration',
    )

    await user.click(within(skillSection).getByRole('button', {
      name: '复制 Codex 配置',
    }))
    expect(writeText).toHaveBeenCalledWith(
      'codex: server-generated stdio configuration',
    )
    expect(projectRepository.getSkillConfigSnippet).toHaveBeenCalledTimes(3)
  })

  it('downloads the real Skill archive and revokes its object URL', async () => {
    const user = userEvent.setup()
    const archive = new Blob(['zip'], { type: 'application/zip' })
    projectRepository.downloadSkill = vi.fn().mockResolvedValue(archive)
    projectRepository.getSkillConfigSnippet = vi.fn(async (client) => ({
      client,
      transport: 'stdio' as const,
      snippet: `${client} config`,
    }))
    const createObjectURL = vi.fn().mockReturnValue('blob:project-os-skill')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL,
      revokeObjectURL,
    }))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    renderApp(<SettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'Skills' }))

    const skillSection = (await screen.findByRole('heading', {
      name: 'Agent Skills',
    })).closest('section')
    if (!skillSection) throw new Error('Expected Skill settings section')
    await user.click(within(skillSection).getByRole('button', {
      name: '下载 Project OS Skill',
    }))

    expect(await within(skillSection).findByRole('status'))
      .toHaveTextContent('下载已开始')
    expect(createObjectURL).toHaveBeenCalledWith(archive)
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:project-os-skill')
  })
})
