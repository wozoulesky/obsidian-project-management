import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  projectQueryKeys,
  projectRepository,
  useCreateHuman,
  useCreateProject,
  useCreateTask,
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
    projectQueryKeys.allTasks,
    projectQueryKeys.activities,
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
  it('invalidates every actor-dependent view after human creation', async () => {
    const { queryClient, wrapper, isInvalidated } = createHarness()
    queryClient.setQueryData(projectQueryKeys.projects, { seeded: true })
    queryClient.setQueryData(projectQueryKeys.actors, { seeded: true })
    const { result } = renderHook(() => useCreateHuman(), { wrapper })

    await act(() => result.current.mutateAsync({
      name: 'Ming',
      role: 'member',
      capabilities: ['research'],
    }))

    expect(isInvalidated(projectQueryKeys.actors)).toBe(true)
    expect(isInvalidated(projectQueryKeys.projects)).toBe(true)
    expect(isInvalidated(projectQueryKeys.tasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.allTasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
    expect(isInvalidated(projectQueryKeys.activities)).toBe(true)
  })

  it('invalidates projects, actors, and every dashboard after creation', async () => {
    const { queryClient, wrapper, isInvalidated } = createHarness()
    queryClient.setQueryData(projectQueryKeys.projects, { seeded: true })
    queryClient.setQueryData(projectQueryKeys.actors, { seeded: true })
    const { result } = renderHook(() => useCreateProject(), { wrapper })

    await act(() =>
      result.current.mutateAsync({
        name: 'Atlas',
        description: '',
        ownerId: 'human-lin',
        startDate: null,
        dueDate: null,
      }),
    )

    expect(isInvalidated(projectQueryKeys.projects)).toBe(true)
    expect(isInvalidated(projectQueryKeys.actors)).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
    expect(isInvalidated(projectQueryKeys.activities)).toBe(true)
  })

  it('invalidates project detail, counts, tasks, gantt, dashboard, and activity after task creation', async () => {
    const { queryClient, wrapper, isInvalidated } = createHarness()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(projectQueryKeys.projects, { seeded: true })
    queryClient.setQueryData(projectQueryKeys.projectFor('atlas'), {
      seeded: true,
    })
    const { result } = renderHook(() => useCreateTask('atlas'), { wrapper })

    await act(() => result.current.mutateAsync({
      title: 'Project task',
      assigneeId: 'human-lin',
      startDate: '2026-07-29',
      dueDate: '2026-07-30',
      priority: 'P1',
    }))

    expect(isInvalidated(projectQueryKeys.projectFor('atlas'))).toBe(true)
    expect(isInvalidated(projectQueryKeys.projects)).toBe(true)
    expect(isInvalidated(projectQueryKeys.tasksFor('atlas'))).toBe(true)
    expect(isInvalidated(projectQueryKeys.allTasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.ganttFor('atlas'))).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
    expect(isInvalidated(projectQueryKeys.activities)).toBe(true)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.projectFor('atlas'),
    })
  })

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
    expect(isInvalidated(projectQueryKeys.requirements)).toBe(true)
    expect(isInvalidated(projectQueryKeys.allTasks)).toBe(true)
  })

  it('invalidates the task actual project after a global progress update', async () => {
    const { queryClient, wrapper, isInvalidated } = createHarness()
    queryClient.setQueryData(projectQueryKeys.tasksFor('borealis'), {
      seeded: true,
    })
    queryClient.setQueryData(projectQueryKeys.ganttFor('borealis'), {
      seeded: true,
    })
    queryClient.setQueryData(projectQueryKeys.requirementsFor('borealis'), {
      seeded: true,
    })
    queryClient.setQueryData(projectQueryKeys.dashboardFor('borealis', 7), {
      seeded: true,
    })
    queryClient.setQueryData(projectQueryKeys.projectFor('borealis'), {
      seeded: true,
    })
    queryClient.setQueryData(projectQueryKeys.projects, { seeded: true })
    const { result } = renderHook(() => useUpdateTaskProgress(), { wrapper })

    await act(() =>
      result.current.mutateAsync({
        taskId: 'task-051',
        projectId: 'borealis',
        input: {
          progress: 71,
          status: 'in_progress',
          note: '',
          version: 3,
        },
      }),
    )

    expect(isInvalidated(projectQueryKeys.tasksFor('borealis'))).toBe(true)
    expect(isInvalidated(projectQueryKeys.ganttFor('borealis'))).toBe(true)
    expect(isInvalidated(projectQueryKeys.requirementsFor('borealis'))).toBe(
      true,
    )
    expect(isInvalidated(projectQueryKeys.dashboardFor('borealis', 7))).toBe(
      true,
    )
    expect(isInvalidated(projectQueryKeys.projectFor('borealis'))).toBe(true)
    expect(isInvalidated(projectQueryKeys.projects)).toBe(true)
    expect(isInvalidated(projectQueryKeys.activities)).toBe(true)
    expect(isInvalidated(projectQueryKeys.allTasks)).toBe(true)
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
    expect(isInvalidated(projectQueryKeys.allTasks)).toBe(true)
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
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
  })
})

describe('shared test repository isolation', () => {
  it('A mutates the shared repository', async () => {
    await projectRepository.updateTaskProgress('task-051', {
      progress: 99,
      status: 'in_progress',
      note: 'test isolation',
    })

    const tasks = await projectRepository.listTasks('atlas')
    expect(tasks.find((task) => task.id === 'task-051')?.progress).toBe(99)
  })

  it('B reads the original fixture after global test cleanup', async () => {
    const tasks = await projectRepository.listTasks('atlas')
    expect(tasks.find((task) => task.id === 'task-051')?.progress).toBe(62)
  })
})
