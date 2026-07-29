import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockProjectRepository } from './mock-project-repository'
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
          },
        ],
        nextCursor: 'activity-next',
      })
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    render(<ActivitySync intervalMs={3_000} />, {
      wrapper: wrapper(queryClient, repository),
    })

    await act(async () => Promise.resolve())
    expect(listActivities).toHaveBeenCalledWith({
      projectId: 'project-1',
    })
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(listActivities).toHaveBeenLastCalledWith({
      after: 'activity-initial',
      projectId: 'project-1',
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.tasksFor('project-1'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.ganttFor('project-1'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.dashboardPrefixFor('project-1'),
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
