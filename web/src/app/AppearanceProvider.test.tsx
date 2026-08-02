import type { PersistedAppSettings } from '@project-os/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../data/api-client'
import { createMockProjectRepository } from '../data/mock-project-repository'
import {
  projectQueryKeys,
  ProjectRepositoryProvider,
} from '../data/query-hooks'
import { AppearanceSettings } from '../features/settings/AppearanceSettings'
import { DataSettings } from '../features/settings/DataSettings'
import {
  useAppearance,
  type Appearance,
} from './appearance-context'
import { AppearanceProvider } from './AppearanceProvider'

const remoteLight: PersistedAppSettings = {
  theme: 'light',
  background: 'solid',
  accent: 'blue',
  density: 'comfortable',
  updatedAt: '2026-07-29T12:00:00.000Z',
  version: 1,
}

function Harness({
  children,
  queryClient,
  repository = createMockProjectRepository(),
}: {
  children: ReactNode
  queryClient?: QueryClient
  repository?: ReturnType<typeof createMockProjectRepository>
}) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return (
    <QueryClientProvider client={client}>
      <ProjectRepositoryProvider repository={repository} projectId="atlas">
        <AppearanceProvider>{children}</AppearanceProvider>
      </ProjectRepositoryProvider>
    </QueryClientProvider>
  )
}

function Probe() {
  const {
    appearance,
    isDirty,
    setAppearance,
    save,
    saveError,
  } = useAppearance()
  return (
    <>
      <output aria-label="当前外观">{JSON.stringify(appearance)}</output>
      <output aria-label="草稿状态">{isDirty ? 'dirty' : 'clean'}</output>
      <button
        onClick={() => setAppearance({
          ...appearance,
          theme: 'dark',
          accent: 'purple',
        })}
        type="button"
      >
        编辑草稿
      </button>
      <button onClick={() => void save()} type="button">保存草稿</button>
      {saveError && <p role="alert">{saveError}</p>}
    </>
  )
}

describe('AppearanceProvider reconciliation', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-background')
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.removeAttribute('data-density')
  })

  it('uses the approved dark glass appearance when no cache or API is available yet', () => {
    const repository = createMockProjectRepository()
    repository.getSettings = vi.fn(() =>
      new Promise<PersistedAppSettings>(() => undefined),
    )

    render(<Harness repository={repository}><Probe /></Harness>)

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-background', 'soft')
    expect(document.documentElement).toHaveAttribute('data-accent', 'teal')
    expect(document.documentElement).toHaveAttribute(
      'data-density',
      'comfortable',
    )
  })

  it('uses local cache synchronously, then applies the API baseline while clean', async () => {
    localStorage.setItem('project-os:appearance', JSON.stringify({
      theme: 'dark',
      background: 'gradient',
      accent: 'orange',
      density: 'compact',
    } satisfies Appearance))
    let resolveSettings:
      ((settings: PersistedAppSettings) => void) | undefined
    const repository = createMockProjectRepository()
    repository.getSettings = vi.fn(() =>
      new Promise<PersistedAppSettings>((resolve) => {
      resolveSettings = resolve
      }),
    )

    render(<Harness repository={repository}><Probe /></Harness>)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute(
      'data-background',
      'gradient',
    )
    expect(document.documentElement).toHaveAttribute('data-accent', 'orange')
    expect(document.documentElement).toHaveAttribute('data-density', 'compact')

    await act(async () => resolveSettings?.(remoteLight))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'light')
      expect(localStorage.getItem('project-os:appearance')).toContain('"blue"')
    })
  })

  it('keeps a dirty draft when a newer API baseline arrives', async () => {
    let resolveSettings:
      ((settings: PersistedAppSettings) => void) | undefined
    const repository = createMockProjectRepository()
    repository.getSettings = vi.fn(() =>
      new Promise<PersistedAppSettings>((resolve) => {
      resolveSettings = resolve
      }),
    )
    const user = userEvent.setup()
    render(<Harness repository={repository}><Probe /></Harness>)

    await user.click(screen.getByRole('button', { name: '编辑草稿' }))
    await act(async () => resolveSettings?.(remoteLight))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
      expect(document.documentElement).toHaveAttribute('data-accent', 'purple')
      expect(screen.getByLabelText('当前外观')).toHaveTextContent('"purple"')
    })
  })

  it('refetches after a 409 without overwriting the draft and retries the new version', async () => {
    const repository = createMockProjectRepository()
    const refreshed = { ...remoteLight, accent: 'orange' as const, version: 2 }
    repository.getSettings = vi.fn()
      .mockResolvedValueOnce(remoteLight)
      .mockResolvedValueOnce(refreshed)
    repository.updateSettings = vi.fn()
      .mockRejectedValueOnce(new ApiError({
        code: 'SETTINGS_VERSION_CONFLICT',
        message: 'Settings version is stale',
        status: 409,
      }))
      .mockResolvedValueOnce({
        ...refreshed,
        theme: 'dark',
        accent: 'purple',
        version: 3,
      })
    const user = userEvent.setup()
    render(<Harness repository={repository}><Probe /></Harness>)
    await screen.findByText(/"blue"/)

    await user.click(screen.getByRole('button', { name: '编辑草稿' }))
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Settings version is stale',
    )
    await waitFor(() => expect(repository.getSettings).toHaveBeenCalledTimes(2))
    expect(document.documentElement).toHaveAttribute('data-accent', 'purple')

    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(repository.updateSettings).toHaveBeenCalledTimes(2))
    expect(vi.mocked(repository.updateSettings).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ accent: 'purple', version: 1 }),
    )
    expect(vi.mocked(repository.updateSettings).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ accent: 'purple', version: 2 }),
    )
  })

  it('preserves edits made while an older save is in flight and saves them next', async () => {
    let resolveFirstSave:
      ((settings: PersistedAppSettings) => void) | undefined
    const repository = createMockProjectRepository()
    repository.getSettings = vi.fn().mockResolvedValue(remoteLight)
    repository.updateSettings = vi.fn()
      .mockImplementationOnce(() =>
        new Promise<PersistedAppSettings>((resolve) => {
          resolveFirstSave = resolve
        }),
      )
      .mockImplementationOnce(async (input) => ({
        ...input,
        updatedAt: '2026-07-29T12:02:00.000Z',
        version: 3,
      }))
    const user = userEvent.setup()
    render(
      <Harness repository={repository}>
        <AppearanceSettings />
        <Probe />
      </Harness>,
    )
    await screen.findByText(/"blue"/)

    await user.click(screen.getByRole('radio', { name: '深色' }))
    await user.click(screen.getByRole('button', { name: '保存外观设置' }))
    await waitFor(() => {
      expect(repository.updateSettings).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('radio', { name: '紫色' }))
    await act(async () => resolveFirstSave?.({
      ...remoteLight,
      theme: 'dark',
      accent: 'blue',
      updatedAt: '2026-07-29T12:01:00.000Z',
      version: 2,
    }))

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '紫色' })).toBeChecked()
      expect(document.documentElement).toHaveAttribute('data-accent', 'purple')
      expect(screen.getByLabelText('草稿状态')).toHaveTextContent('dirty')
    })

    await user.click(screen.getByRole('button', { name: '保存外观设置' }))
    await waitFor(() => {
      expect(repository.updateSettings).toHaveBeenCalledTimes(2)
      expect(screen.getByLabelText('草稿状态')).toHaveTextContent('clean')
    })
    expect(vi.mocked(repository.updateSettings).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ accent: 'purple', version: 2 }),
    )
  })

  it('does not roll back a newer API baseline when an older save resolves', async () => {
    let resolveStaleSave:
      ((settings: PersistedAppSettings) => void) | undefined
    const versionTwo = { ...remoteLight, version: 2 }
    const versionThree = {
      ...remoteLight,
      theme: 'dark' as const,
      accent: 'orange' as const,
      updatedAt: '2026-07-29T12:03:00.000Z',
      version: 3,
    }
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const repository = createMockProjectRepository()
    repository.getSettings = vi.fn().mockResolvedValue(versionTwo)
    repository.updateSettings = vi.fn()
      .mockImplementationOnce(() =>
        new Promise<PersistedAppSettings>((resolve) => {
          resolveStaleSave = resolve
        }),
      )
      .mockImplementationOnce(async (input) => ({
        ...input,
        updatedAt: '2026-07-29T12:04:00.000Z',
        version: 4,
      }))
    const user = userEvent.setup()
    render(
      <Harness queryClient={queryClient} repository={repository}>
        <Probe />
      </Harness>,
    )
    await screen.findByText(/"blue"/)

    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(repository.updateSettings).toHaveBeenCalledTimes(1)
    })

    act(() => {
      queryClient.setQueryData(projectQueryKeys.settings, versionThree)
    })
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-accent', 'orange')
    })

    await act(async () => resolveStaleSave?.({
      ...versionTwo,
      updatedAt: '2026-07-29T12:02:00.000Z',
    }))

    await waitFor(() => {
      expect(
        queryClient.getQueryData<PersistedAppSettings>(
          projectQueryKeys.settings,
        )?.version,
      ).toBe(3)
      expect(document.documentElement).toHaveAttribute('data-accent', 'orange')
      expect(screen.getByLabelText('草稿状态')).toHaveTextContent('clean')
    })

    await user.click(screen.getByRole('button', { name: '编辑草稿' }))
    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(repository.updateSettings).toHaveBeenCalledTimes(2)
    })
    expect(vi.mocked(repository.updateSettings).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ version: 3 }),
    )
  })

  it('applies restored and imported API appearance while the draft is clean', async () => {
    let current = remoteLight
    const repository = createMockProjectRepository()
    repository.getSettings = vi.fn(async () => current)
    repository.restoreBackup = vi.fn(async (filename) => {
      current = {
        ...current,
        theme: 'dark',
        accent: 'orange',
        version: current.version + 1,
      }
      return { filename, path: `backups/${filename}` }
    })
    repository.importData = vi.fn(async () => {
      current = {
        ...current,
        theme: 'light',
        accent: 'purple',
        version: current.version + 1,
      }
      return {
        ok: true as const,
        counts: {
          actors: 0,
          projects: 0,
          projectMembers: 0,
          tasks: 0,
          requirements: 0,
          defects: 0,
          sessions: 0,
          handoffs: 0,
          deliverables: 0,
        },
      }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(
      <Harness repository={repository}>
        <AppearanceSettings />
        <DataSettings />
      </Harness>,
    )
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-accent', 'blue')
    })

    await user.click(screen.getByRole('button', { name: '创建备份' }))
    await user.click(screen.getByRole('button', { name: '恢复此备份' }))
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
      expect(document.documentElement).toHaveAttribute('data-accent', 'orange')
    })

    await user.upload(
      screen.getByLabelText('选择要导入的 JSON 文件'),
      new File(['{}'], 'project-os.json', { type: 'application/json' }),
    )
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'light')
      expect(document.documentElement).toHaveAttribute('data-accent', 'purple')
      expect(localStorage.getItem('project-os:appearance')).toContain('"purple"')
    })
  })
})
