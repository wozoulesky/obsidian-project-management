import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import {
  projectQueryKeys,
  useCreateTaskFromDefect,
  useUpdateRequirementStatus,
  useUpdateTaskDates,
  useUpdateTaskProgress,
} from './query-hooks'

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const keys = [
    projectQueryKeys.tasks,
    projectQueryKeys.gantt,
    projectQueryKeys.dashboard(7),
    projectQueryKeys.requirements,
    projectQueryKeys.defects,
  ]
  for (const key of keys) {
    queryClient.setQueryData(key, { seeded: true })
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const isInvalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated

  return { queryClient, wrapper, isInvalidated }
}

describe('repository query invalidation', () => {
  it('invalidates all progress-dependent views', async () => {
    const { wrapper, isInvalidated } = createHarness()
    const { result } = renderHook(() => useUpdateTaskProgress(), { wrapper })

    await act(() =>
      result.current.mutateAsync({
        taskId: 'task-051',
        input: { progress: 71, status: 'in_progress', note: '' },
      }),
    )

    expect(isInvalidated(projectQueryKeys.tasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.gantt)).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
  })

  it('invalidates all scheduling-dependent views', async () => {
    const { wrapper, isInvalidated } = createHarness()
    const { result } = renderHook(() => useUpdateTaskDates(), { wrapper })

    await act(() =>
      result.current.mutateAsync({
        taskId: 'task-051',
        input: { startDate: '2026-07-24', dueDate: '2026-07-29' },
      }),
    )

    expect(isInvalidated(projectQueryKeys.tasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.gantt)).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
  })

  it('invalidates requirements and dashboard after a status change', async () => {
    const { wrapper, isInvalidated } = createHarness()
    const { result } = renderHook(() => useUpdateRequirementStatus(), {
      wrapper,
    })

    await act(() =>
      result.current.mutateAsync({
        requirementId: 'req-017',
        status: 'delivered',
      }),
    )

    expect(isInvalidated(projectQueryKeys.requirements)).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
  })

  it('invalidates task, gantt, and defect views after conversion', async () => {
    const { wrapper, isInvalidated } = createHarness()
    const { result } = renderHook(() => useCreateTaskFromDefect(), { wrapper })

    await act(() => result.current.mutateAsync('defect-104'))

    expect(isInvalidated(projectQueryKeys.tasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.gantt)).toBe(true)
    expect(isInvalidated(projectQueryKeys.defects)).toBe(true)
  })
})
