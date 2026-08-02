import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockProjectRepository } from './mock-project-repository'
import type { ActivityPage } from './project-repository'
import {
  ProjectRepositoryProvider,
  projectQueryKeys,
} from './query-hooks'
import { ActivitySync } from './ActivitySync'

function wrapper(
  queryClient: QueryClient,
  repository: ReturnType<typeof createMockProjectRepository>,
) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ProjectRepositoryProvider
        repository={repository}
        projectId="project-1"
      >
        {children}
      </ProjectRepositoryProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ActivitySync', () => {
  it('coalesces interval and visibility triggers while a poll is pending', async () => {
    vi.useFakeTimers()
    const repository = createMockProjectRepository()
    let resolveInitial!: (page: ActivityPage) => void
    const initial = new Promise<ActivityPage>((resolve) => {
      resolveInitial = resolve
    })
    const listActivities = vi
      .spyOn(repository, 'listActivities')
      .mockReturnValueOnce(initial)
      .mockResolvedValue({ items: [], nextCursor: 'activity-initial' })

    render(<ActivitySync intervalMs={3_000} />, {
      wrapper: wrapper(new QueryClient(), repository),
    })
    await act(async () => Promise.resolve())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(listActivities).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveInitial({ items: [], nextCursor: 'activity-initial' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(listActivities).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(listActivities).toHaveBeenCalledTimes(2)
  })

  it('uses the initial page only as a cursor, then invalidates MCP-affected queries', async () => {
    vi.useFakeTimers()
    const repository = createMockProjectRepository()
    const listActivities = vi
      .spyOn(repository, 'listActivities')
      .mockResolvedValueOnce({
        items: [
          {
            id: 'activity-initial',
            actor: {
              id: 'agent-1',
              name: 'Agent',
              kind: 'agent',
              role: 'dev-agent',
            },
            action: 'Existing activity',
            operation: 'task.update',
            createdAt: '2026-07-29T00:00:00.000Z',
            source: 'mcp',
          },
        ],
        nextCursor: 'activity-initial',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'activity-next',
            actor: {
              id: 'agent-1',
              name: 'Agent',
              kind: 'agent',
              role: 'dev-agent',
            },
            action: 'External task update',
            operation: 'task.update',
            createdAt: '2026-07-29T00:00:03.000Z',
            source: 'mcp',
            projectId: 'project-2',
          },
          {
            id: 'activity-project',
            actor: {
              id: 'agent-1',
              name: 'Agent',
              kind: 'agent',
              role: 'dev-agent',
            },
            action: 'External project creation',
            operation: 'project.create',
            createdAt: '2026-07-29T00:00:04.000Z',
            source: 'mcp',
            projectId: 'project-new',
          },
          {
            id: 'activity-actor',
            actor: {
              id: 'agent-1',
              name: 'Agent',
              kind: 'agent',
              role: 'dev-agent',
            },
            action: 'External actor update',
            operation: 'actor.update',
            createdAt: '2026-07-29T00:00:05.000Z',
            source: 'mcp',
          },
        ],
        nextCursor: 'activity-actor',
      })
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    render(<ActivitySync intervalMs={3_000} />, {
      wrapper: wrapper(queryClient, repository),
    })

    await act(async () => Promise.resolve())
    expect(listActivities).toHaveBeenCalledWith({})
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(listActivities).toHaveBeenLastCalledWith({
      after: 'activity-initial',
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.tasksFor('project-2'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.allTasks,
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.ganttFor('project-2'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.dashboardPrefixFor('project-2'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.workspaceDashboardPrefix,
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.projects,
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.actors,
    })
  })

  it('recovers on the next interval after a poll rejection', async () => {
    vi.useFakeTimers()
    const repository = createMockProjectRepository()
    const listActivities = vi
      .spyOn(repository, 'listActivities')
      .mockResolvedValueOnce({ items: [], nextCursor: 'activity-initial' })
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce({
        items: [{
          id: 'activity-recovered',
          actor: {
            id: 'agent-1',
            name: 'Agent',
            kind: 'agent',
            role: 'dev-agent',
          },
          action: 'Recovered update',
          operation: 'task.update',
          createdAt: '2026-07-29T00:00:06.000Z',
          source: 'mcp',
          projectId: 'project-2',
        }],
        nextCursor: 'activity-recovered',
      })
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    render(<ActivitySync intervalMs={3_000} />, {
      wrapper: wrapper(queryClient, repository),
    })
    await act(async () => Promise.resolve())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })

    expect(listActivities).toHaveBeenNthCalledWith(2, {
      after: 'activity-initial',
    })
    expect(listActivities).toHaveBeenNthCalledWith(3, {
      after: 'activity-initial',
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.tasksFor('project-2'),
    })
  })

  it('does not poll while the document is hidden and resumes when visible', async () => {
    vi.useFakeTimers()
    const repository = createMockProjectRepository()
    const listActivities = vi
      .spyOn(repository, 'listActivities')
      .mockResolvedValue({ items: [], nextCursor: null })
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden')

    render(<ActivitySync intervalMs={3_000} />, {
      wrapper: wrapper(new QueryClient(), repository),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(listActivities).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(listActivities).toHaveBeenCalledTimes(1)
  })
})
