import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '../../app/test-utils'
import { projectRepository } from '../../data/query-hooks'
import { SettingsPage } from './SettingsPage'

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

  it('renders all non-empty settings sections', async () => {
    renderApp(<SettingsPage />)

    for (const name of ['外观', '常规', '数据', 'MCP', 'Agent Skills']) {
      const heading = await screen.findByRole('heading', { name })
      expect(heading.closest('section')).toHaveTextContent(/\S/)
    }
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

    const dataSection = (await screen.findByRole('heading', { name: '数据' }))
      .closest('section')
    if (!dataSection) throw new Error('Expected data settings section')

    await user.click(within(dataSection).getByRole('button', {
      name: '创建备份',
    }))
    expect(await within(dataSection).findByText(
      /project-os-test-\d+\.sqlite/,
      { selector: 'code' },
    ))
      .toBeVisible()

    await user.click(within(dataSection).getByRole('button', {
      name: '恢复此备份',
    }))
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('project-os-test-'),
    )
    expect(await within(dataSection).findByRole('status'))
      .toHaveTextContent('备份已恢复')
  })

  it('imports JSON within the API limit and reports all returned counts', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />)

    await user.upload(
      await screen.findByLabelText('选择要导入的 JSON 文件'),
      new File(['{}'], 'project-os.json', { type: 'application/json' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      /负责人 6，项目 1，成员关系 6，任务 50，需求 20，缺陷 7/,
    )
  })

  it('shows an issued token once and never stores the secret', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    renderApp(<SettingsPage />)

    await user.type(await screen.findByLabelText('令牌名称'), 'local-codex')
    await user.click(screen.getByRole('button', { name: '签发令牌' }))

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('仅显示一次')
    const token = within(warning).getByText(/^pos_/).textContent
    expect(token).toBeTruthy()
    expect(localStorage.getItem('project-os:appearance')).not.toContain('pos_')

    await user.click(within(warning).getByRole('button', {
      name: '复制令牌',
    }))
    expect(writeText).toHaveBeenCalledWith(token)
    await user.click(within(warning).getByRole('button', {
      name: '我已保存，隐藏令牌',
    }))
    expect(screen.queryByText(token!)).not.toBeInTheDocument()
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

    const skillSection = (await screen.findByRole('heading', {
      name: 'Agent Skills',
    })).closest('section')
    if (!skillSection) throw new Error('Expected Skill settings section')
    expect(screen.getByText('http://127.0.0.1:4310/mcp')).toBeVisible()
    expect(screen.queryByText(/5173\/mcp/)).not.toBeInTheDocument()
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
