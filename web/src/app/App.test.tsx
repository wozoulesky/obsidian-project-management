import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { Project, ProjectStatus } from '../data/domain'
import { httpProjectRepository } from '../data/http-project-repository'
import { App } from './App'
import { selectAppRepository } from './app-repository'
import { renderApp } from './test-utils'

function project(id: string, status: ProjectStatus): Project {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    description: '',
    ownerId: 'human-lin',
    startDate: null,
    dueDate: null,
    status,
    progress: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    version: 1,
  }
}

function renderProductionApp(route = '/tasks') {
  window.history.pushState({}, '', route)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

function stubBackgroundQueries() {
  vi.spyOn(httpProjectRepository, 'getSettings').mockResolvedValue({
    theme: 'dark',
    background: 'soft',
    accent: 'teal',
    density: 'comfortable',
    updatedAt: '2026-07-01T00:00:00.000Z',
    version: 1,
  })
  vi.spyOn(httpProjectRepository, 'listActivities').mockResolvedValue({
    items: [],
    nextCursor: null,
  })
}

describe('App', () => {
  it('fails closed to HTTP unless both E2E mode and fixtures are explicit', () => {
    expect(selectAppRepository('production', 'true'))
      .toBe(httpProjectRepository)
    expect(selectAppRepository('e2e', 'false')).toBe(httpProjectRepository)
    expect(selectAppRepository('e2e', undefined)).toBe(httpProjectRepository)
    expect(selectAppRepository('e2e', 'true'))
      .not.toBe(httpProjectRepository)
  })

  it('starts with a valid saved workspace project', async () => {
    sessionStorage.setItem('project-os:workspace-project', 'saved-project')
    vi.spyOn(httpProjectRepository, 'listProjects').mockResolvedValue([
      project('project_default', 'in_progress'),
      project('saved-project', 'completed'),
      project('active-project', 'in_progress'),
    ])
    const listTasks = vi.spyOn(httpProjectRepository, 'listTasks')
      .mockResolvedValue([])
    stubBackgroundQueries()

    renderProductionApp()

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith(
      'saved-project',
    ))
    expect(listTasks).not.toHaveBeenCalledWith('project_default')
  })

  it('waits for projects then prefers the first in-progress non-default project', async () => {
    sessionStorage.removeItem('project-os:workspace-project')
    let resolveProjects!: (projects: Project[]) => void
    const projectsPromise = new Promise<Project[]>((resolve) => {
      resolveProjects = resolve
    })
    vi.spyOn(httpProjectRepository, 'listProjects')
      .mockReturnValue(projectsPromise)
    const listTasks = vi.spyOn(httpProjectRepository, 'listTasks')
      .mockResolvedValue([])
    stubBackgroundQueries()

    const { container } = renderProductionApp()

    expect(container.querySelector('.data-state--loading'))
      .toBeInTheDocument()
    expect(listTasks).not.toHaveBeenCalled()

    await act(async () => resolveProjects([
      project('project_default', 'in_progress'),
      project('completed-project', 'completed'),
      project('on-hold-project', 'on_hold'),
      project('not-started-project', 'not_started'),
      project('active-project', 'in_progress'),
    ]))

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith(
      'active-project',
    ))
    expect(listTasks).not.toHaveBeenCalledWith('project_default')
    expect(sessionStorage.getItem('project-os:workspace-project'))
      .toBe('active-project')
  })

  it('prefers a not-started project when none is in progress', async () => {
    sessionStorage.removeItem('project-os:workspace-project')
    vi.spyOn(httpProjectRepository, 'listProjects').mockResolvedValue([
      project('project_default', 'completed'),
      project('completed-project', 'completed'),
      project('on-hold-project', 'on_hold'),
      project('not-started-project', 'not_started'),
    ])
    const listTasks = vi.spyOn(httpProjectRepository, 'listTasks')
      .mockResolvedValue([])
    stubBackgroundQueries()

    renderProductionApp()

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith(
      'not-started-project',
    ))
  })

  it('prefers an on-hold project before an inactive fallback', async () => {
    sessionStorage.removeItem('project-os:workspace-project')
    vi.spyOn(httpProjectRepository, 'listProjects').mockResolvedValue([
      project('project_default', 'completed'),
      project('completed-project', 'completed'),
      project('on-hold-project', 'on_hold'),
    ])
    const listTasks = vi.spyOn(httpProjectRepository, 'listTasks')
      .mockResolvedValue([])
    stubBackgroundQueries()

    renderProductionApp()

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith(
      'on-hold-project',
    ))
  })

  it('falls back to the first non-default project', async () => {
    sessionStorage.removeItem('project-os:workspace-project')
    vi.spyOn(httpProjectRepository, 'listProjects').mockResolvedValue([
      project('project_default', 'completed'),
      project('completed-project', 'completed'),
      project('cancelled-project', 'cancelled'),
    ])
    const listTasks = vi.spyOn(httpProjectRepository, 'listTasks')
      .mockResolvedValue([])
    stubBackgroundQueries()

    renderProductionApp()

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith(
      'completed-project',
    ))
  })

  it('keeps workspace blocked after a project-list error and recovers on retry', async () => {
    sessionStorage.removeItem('project-os:workspace-project')
    vi.spyOn(httpProjectRepository, 'listProjects')
      .mockRejectedValueOnce(new Error('projects unavailable'))
      .mockResolvedValue([
        project('project_default', 'in_progress'),
        project('active-project', 'in_progress'),
      ])
    const listTasks = vi.spyOn(httpProjectRepository, 'listTasks')
      .mockResolvedValue([])
    stubBackgroundQueries()

    renderProductionApp()

    await screen.findByRole('alert', {
      name: '无法读取本地项目数据',
    })
    expect(listTasks).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith(
      'active-project',
    ))
    expect(listTasks).not.toHaveBeenCalledWith('project_default')
  })

  it('uses the shared loading skeleton while workspace scope resolves', () => {
    const { container, unmount } = renderApp(<App />)

    const loadingState = screen.getByRole('status')
    expect(loadingState).toHaveClass('data-state--loading')
    expect(loadingState).toHaveAttribute('aria-busy', 'true')
    expect(
      loadingState.querySelector('.data-state__skeleton'),
    ).toBeInTheDocument()
    expect(container.querySelector('.dashboard-page')).not.toBeInTheDocument()
    unmount()
  })

  it('uses standard page landmarks without overriding the application role', async () => {
    renderApp(<App />)

    expect(screen.queryByRole('application')).not.toBeInTheDocument()
    expect(await screen.findByRole('main')).toHaveAttribute(
      'id',
      'main-content',
    )
  })
})
