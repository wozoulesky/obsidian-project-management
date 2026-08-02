import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  ProjectRepositoryProvider,
  projectId,
  projectOwnedQueryKeys,
  projectQueryKeys,
  projectRepository,
  useDeleteProject,
  useProjectDeliverables,
  useProjectHandoffs,
  useProjectSessions,
  useCreateHuman,
  useCreateProject,
  useCreateTask,
  useCreateTaskFromDefect,
  useCurrentActor,
  useDashboard,
  useProject,
  useProjectRepository,
  useImportData,
  useRestoreBackup,
  useTasks,
  useUpdateRequirementStatus,
  useUpdateTaskDates,
  useUpdateTaskProgress,
  useWorkspaceDashboard,
  workspaceProjectStorageKey,
} from './query-hooks'
import { createMockProjectRepository } from './mock-project-repository'

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const keys = [
    projectQueryKeys.tasks,
    projectQueryKeys.gantt,
    projectQueryKeys.dashboard(7),
    projectQueryKeys.workspaceDashboardFor(7),
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

function createDeleteHarness(
  repository: ReturnType<typeof createMockProjectRepository>,
  selectedProjectId: string,
  gcTime?: number,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ProjectRepositoryProvider
        repository={repository}
        projectId={selectedProjectId}
      >
        {children}
      </ProjectRepositoryProvider>
    </QueryClientProvider>
  )
  return { queryClient, wrapper }
}

function seedOwnedCaches(queryClient: QueryClient, selectedProjectId: string) {
  const entries = [
    projectQueryKeys.projectFor(selectedProjectId),
    projectQueryKeys.projectMembersFor(selectedProjectId),
    projectQueryKeys.tasksFor(selectedProjectId),
    projectQueryKeys.requirementsFor(selectedProjectId),
    projectQueryKeys.defectsFor(selectedProjectId),
    projectQueryKeys.ganttFor(selectedProjectId),
    projectQueryKeys.dashboardFor(selectedProjectId, 7),
    projectQueryKeys.dashboardFor(selectedProjectId, 30),
    projectQueryKeys.sessionsFor(selectedProjectId),
    projectQueryKeys.handoffsFor(selectedProjectId),
    projectQueryKeys.deliverablesFor(selectedProjectId),
  ]
  entries.forEach((queryKey, index) => {
    queryClient.setQueryData(queryKey, `${selectedProjectId}-${index}`)
  })
  return entries
}

describe('project deletion synchronization', () => {
  it('describes every owned exact key and the project dashboard prefix', () => {
    expect(projectOwnedQueryKeys('atlas')).toEqual([
      { queryKey: projectQueryKeys.projectFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.projectMembersFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.tasksFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.requirementsFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.defectsFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.ganttFor('atlas'), exact: true },
      {
        queryKey: projectQueryKeys.dashboardPrefixFor('atlas'),
        exact: false,
      },
      { queryKey: projectQueryKeys.sessionsFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.handoffsFor('atlas'), exact: true },
      { queryKey: projectQueryKeys.deliverablesFor('atlas'), exact: true },
    ])
  })

  it('removes deleted project data and restores the current selection', async () => {
    const repository = createMockProjectRepository()
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    const atlas = await repository.getProject('atlas')
    const projects = [
      atlas,
      { ...atlas, id: 'project_default', code: 'DEFAULT', name: 'Default' },
      { ...atlas, id: 'borealis', code: 'BOREALIS', name: 'Borealis' },
    ]
    queryClient.setQueryData(projectQueryKeys.projects, projects)
    queryClient.setQueryData(projectQueryKeys.allTasks, [
      { id: 'atlas-task', projectId: 'atlas' },
      { id: 'default-task', projectId: 'project_default' },
      { id: 'borealis-task', projectId: 'borealis' },
    ])
    const deletedKeys = seedOwnedCaches(queryClient, 'atlas')
    const otherKeys = seedOwnedCaches(queryClient, 'borealis')
    queryClient.setQueryData(
      projectQueryKeys.workspaceDashboardFor(7),
      'workspace-dashboard',
    )
    queryClient.setQueryData(projectQueryKeys.activities, 'activities')
    sessionStorage.setItem(workspaceProjectStorageKey, 'atlas')
    const getProject = vi.spyOn(repository, 'getProject')
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => ({
      activeProject: useProject('atlas'),
      deletion: useDeleteProject(),
      selection: useProjectRepository(),
    }), { wrapper })

    await act(() => result.current.deletion.mutateAsync({
      projectId: 'atlas',
      version: 1,
    }))

    expect(queryClient.getQueryData(projectQueryKeys.projects))
      .toEqual(projects.slice(1))
    expect(queryClient.getQueryData(projectQueryKeys.allTasks)).toEqual([
      { id: 'default-task', projectId: 'project_default' },
      { id: 'borealis-task', projectId: 'borealis' },
    ])
    for (const queryKey of deletedKeys) {
      expect(queryClient.getQueryData(queryKey)).toBeUndefined()
    }
    expect(queryClient.getQueryState(
      projectQueryKeys.projectFor('atlas'),
    )).toMatchObject({ status: 'pending', error: null, fetchStatus: 'idle' })
    for (const queryKey of otherKeys) {
      expect(queryClient.getQueryData(queryKey)).toBeDefined()
    }
    expect(result.current.selection.projectId).toBe('project_default')
    expect(sessionStorage.getItem(workspaceProjectStorageKey))
      .toBe('project_default')
    expect(queryClient.getQueryState(
      projectQueryKeys.workspaceDashboardFor(7),
    )?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(projectQueryKeys.activities)?.isInvalidated)
      .toBe(true)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.projects,
      exact: true,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.allTasks,
      exact: true,
    })
    for (const { queryKey } of projectOwnedQueryKeys('atlas')) {
      expect(invalidateQueries).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey }),
      )
    }
    expect(getProject).not.toHaveBeenCalled()
  })

  it('leaves cache, storage, and selection untouched when deletion fails', async () => {
    const repository = createMockProjectRepository()
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    const atlas = await repository.getProject('atlas')
    queryClient.setQueryData(projectQueryKeys.projects, [atlas])
    queryClient.setQueryData(projectQueryKeys.allTasks, [
      { id: 'atlas-task', projectId: 'atlas' },
    ])
    seedOwnedCaches(queryClient, 'atlas')
    seedOwnedCaches(queryClient, 'borealis')
    queryClient.setQueryData(
      projectQueryKeys.workspaceDashboardFor(7),
      'workspace-dashboard',
    )
    queryClient.setQueryData(projectQueryKeys.activities, 'activities')
    sessionStorage.setItem(workspaceProjectStorageKey, 'atlas')
    const snapshot = () => queryClient.getQueryCache().getAll()
      .map((query) => ({
        queryHash: query.queryHash,
        data: query.state.data,
        isInvalidated: query.state.isInvalidated,
      }))
      .sort((left, right) => left.queryHash.localeCompare(right.queryHash))
    const before = snapshot()
    const { result } = renderHook(() => ({
      deletion: useDeleteProject(),
      selection: useProjectRepository(),
    }), { wrapper })

    await expect(act(() => result.current.deletion.mutateAsync({
      projectId: 'atlas',
      version: 2,
    }))).rejects.toThrow('Project version is stale')

    expect(snapshot()).toEqual(before)
    expect(result.current.selection.projectId).toBe('atlas')
    expect(sessionStorage.getItem(workspaceProjectStorageKey)).toBe('atlas')
  })

  it('does not change selection when a different project is deleted', async () => {
    const repository = createMockProjectRepository()
    const { queryClient, wrapper } = createDeleteHarness(
      repository,
      'project_default',
    )
    const atlas = await repository.getProject('atlas')
    const projects = [
      atlas,
      { ...atlas, id: 'project_default', code: 'DEFAULT', name: 'Default' },
    ]
    queryClient.setQueryData(projectQueryKeys.projects, projects)
    queryClient.setQueryData(projectQueryKeys.allTasks, [
      { id: 'atlas-task', projectId: 'atlas' },
      { id: 'default-task', projectId: 'project_default' },
    ])
    seedOwnedCaches(queryClient, 'atlas')
    sessionStorage.setItem(workspaceProjectStorageKey, 'project_default')
    const { result } = renderHook(() => ({
      deletion: useDeleteProject(),
      selection: useProjectRepository(),
    }), { wrapper })

    await act(() => result.current.deletion.mutateAsync({
      projectId: 'atlas',
      version: 1,
    }))

    expect(result.current.selection.projectId).toBe('project_default')
    expect(sessionStorage.getItem(workspaceProjectStorageKey))
      .toBe('project_default')
  })

  it('keeps deleted project queries disabled after inactive cache GC', async () => {
    const repository = createMockProjectRepository()
    const { wrapper } = createDeleteHarness(
      repository,
      'project_default',
      10,
    )
    const deletion = renderHook(() => useDeleteProject(), { wrapper })

    await act(() => deletion.result.current.mutateAsync({
      projectId: 'atlas',
      version: 1,
    }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    const getProject = vi.spyOn(repository, 'getProject')

    const project = renderHook(() => useProject('atlas'), { wrapper })
    await act(async () => Promise.resolve())

    expect(project.result.current.fetchStatus).toBe('idle')
    expect(getProject).not.toHaveBeenCalled()
  })

  it.each(['restore', 'import'] as const)(
    'clears deletion guards after successful %s',
    async (operation) => {
      const repository = createMockProjectRepository()
      const atlas = await repository.getProject('atlas')
      const { wrapper } = createDeleteHarness(
        repository,
        'project_default',
      )
      const deletion = renderHook(() => useDeleteProject(), { wrapper })
      await act(() => deletion.result.current.mutateAsync({
        projectId: 'atlas',
        version: 1,
      }))
      const getProject = vi.spyOn(repository, 'getProject')
        .mockResolvedValue(atlas)
      const hooks = renderHook(() => ({
        project: useProject('atlas'),
        restore: useRestoreBackup(),
        importData: useImportData(),
      }), { wrapper })
      expect(getProject).not.toHaveBeenCalled()

      if (operation === 'restore') {
        await act(() => hooks.result.current.restore.mutateAsync(
          'snapshot.sqlite',
        ))
      } else {
        await act(() => hooks.result.current.importData.mutateAsync(
          new File(['backup'], 'backup.sqlite'),
        ))
      }

      await waitFor(() => expect(getProject).toHaveBeenCalledWith('atlas'))
    },
  )

  it.each([
    {
      remainingIds: ['borealis'],
      expectedSelection: 'borealis',
    },
    {
      remainingIds: [] as string[],
      expectedSelection: 'project_default',
    },
  ])(
    'falls back to $expectedSelection when the current project is deleted',
    async ({ remainingIds, expectedSelection }) => {
      const repository = createMockProjectRepository()
      const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
      const atlas = await repository.getProject('atlas')
      queryClient.setQueryData(projectQueryKeys.projects, [
        atlas,
        ...remainingIds.map((id) => ({
          ...atlas,
          id,
          code: id.toUpperCase(),
          name: id,
        })),
      ])
      queryClient.setQueryData(projectQueryKeys.allTasks, [])
      sessionStorage.setItem(workspaceProjectStorageKey, 'atlas')
      const { result } = renderHook(() => ({
        deletion: useDeleteProject(),
        selection: useProjectRepository(),
      }), { wrapper })

      await act(() => result.current.deletion.mutateAsync({
        projectId: 'atlas',
        version: 1,
      }))

      expect(result.current.selection.projectId).toBe(expectedSelection)
      expect(sessionStorage.getItem(workspaceProjectStorageKey))
        .toBe(expectedSelection)
    },
  )
})

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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
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
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
  })

  it('invalidates task, gantt, and defect views after conversion', async () => {
    const { wrapper, isInvalidated } = createHarness()
    const { result } = renderHook(() => useCreateTaskFromDefect(), { wrapper })

    await act(() => result.current.mutateAsync('defect-104'))

    expect(isInvalidated(projectQueryKeys.tasks)).toBe(true)
    expect(isInvalidated(projectQueryKeys.gantt)).toBe(true)
    expect(isInvalidated(projectQueryKeys.defects)).toBe(true)
    expect(isInvalidated(projectQueryKeys.dashboard(7))).toBe(true)
    expect(isInvalidated(projectQueryKeys.workspaceDashboardFor(7))).toBe(
      true,
    )
  })
})

describe('workspace dashboard query', () => {
  it('uses a cache key and repository call independent from project scope', async () => {
    const { queryClient, wrapper } = createHarness()
    const workspaceSnapshot = await projectRepository.getDashboard('atlas', 7)
    const workspaceDashboard = vi
      .spyOn(projectRepository, 'getWorkspaceDashboard')
      .mockResolvedValue(workspaceSnapshot)
    const projectDashboard = vi.spyOn(projectRepository, 'getDashboard')
      .mockResolvedValue(workspaceSnapshot)

    const workspace = renderHook(() => useWorkspaceDashboard(7), { wrapper })
    const project = renderHook(() => useDashboard(7), { wrapper })

    await waitFor(() => expect(workspace.result.current.data).toBeDefined())
    await waitFor(() => expect(project.result.current.data).toBeDefined())

    expect(workspaceDashboard).toHaveBeenCalledWith(7)
    expect(projectDashboard).toHaveBeenCalledWith(projectId, 7)
    expect(projectQueryKeys.workspaceDashboardFor(7)).not.toEqual(
      projectQueryKeys.dashboardFor('workspace', 7),
    )
    expect(queryClient.getQueryData(
      projectQueryKeys.workspaceDashboardFor(7),
    )).toEqual(workspaceSnapshot)
  })
})

describe('workspace project scope', () => {
  it('refetches tasks into a separate cache when the project changes', async () => {
    sessionStorage.removeItem('project-os:workspace-project')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const listTasks = vi.spyOn(projectRepository, 'listTasks')
      .mockImplementation(async (selectedProjectId) => ([{
        id: `${selectedProjectId}-task`,
      }] as Awaited<ReturnType<typeof projectRepository.listTasks>>))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ProjectRepositoryProvider
          repository={projectRepository}
          projectId="project_default"
        >
          {children}
        </ProjectRepositoryProvider>
      </QueryClientProvider>
    )

    const { result } = renderHook(() => ({
      repository: useProjectRepository(),
      tasks: useTasks(),
    }), { wrapper })

    await waitFor(() => expect(result.current.tasks.data).toEqual([{
      id: 'project_default-task',
    }]))

    act(() => result.current.repository.selectProject('atlas'))

    await waitFor(() => expect(result.current.tasks.data).toEqual([{
      id: 'atlas-task',
    }]))
    expect(listTasks).toHaveBeenNthCalledWith(1, 'project_default')
    expect(listTasks).toHaveBeenNthCalledWith(2, 'atlas')
    expect(queryClient.getQueryData(
      projectQueryKeys.tasksFor('project_default'),
    )).toEqual([{ id: 'project_default-task' }])
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('atlas')))
      .toEqual([{ id: 'atlas-task' }])
    expect(sessionStorage.getItem('project-os:workspace-project'))
      .toBe('atlas')
  })
})

describe('current actor query', () => {
  it('uses a stable key and returns the configured mock owner', async () => {
    const { queryClient, wrapper } = createHarness()
    const owner = await projectRepository.getCurrentActor()

    const { result } = renderHook(() => useCurrentActor(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(owner))

    expect(projectQueryKeys.currentActor).toEqual(['actors', 'current'])
    expect(owner).toMatchObject({
      id: 'human-lin',
      name: 'Lin',
      kind: 'human',
    })
    expect(queryClient.getQueryData(projectQueryKeys.currentActor))
      .toEqual(result.current.data)
  })
})

describe('relay queries', () => {
  it('uses stable project-scoped keys for all relay resources', async () => {
    const { queryClient, wrapper } = createHarness()
    const sessions = vi.spyOn(projectRepository, 'listProjectSessions')
      .mockResolvedValue([])
    const handoffs = vi.spyOn(projectRepository, 'listProjectHandoffs')
      .mockResolvedValue([])
    const deliverables = vi.spyOn(
      projectRepository,
      'listProjectDeliverables',
    ).mockResolvedValue([])

    const sessionsHook = renderHook(() => useProjectSessions('atlas'), {
      wrapper,
    })
    const handoffsHook = renderHook(() => useProjectHandoffs('atlas'), {
      wrapper,
    })
    const deliverablesHook = renderHook(
      () => useProjectDeliverables('atlas'),
      { wrapper },
    )

    await act(async () => {
      await Promise.all([
        sessionsHook.result.current.refetch(),
        handoffsHook.result.current.refetch(),
        deliverablesHook.result.current.refetch(),
      ])
    })

    expect(sessions).toHaveBeenCalledWith('atlas')
    expect(handoffs).toHaveBeenCalledWith('atlas')
    expect(deliverables).toHaveBeenCalledWith('atlas')
    expect(queryClient.getQueryData(
      projectQueryKeys.sessionsFor('atlas'),
    )).toEqual([])
    expect(queryClient.getQueryData(
      projectQueryKeys.handoffsFor('atlas'),
    )).toEqual([])
    expect(queryClient.getQueryData(
      projectQueryKeys.deliverablesFor('atlas'),
    )).toEqual([])
  })

  it('does not request relay resources without a selected project', () => {
    const { wrapper } = createHarness()
    const sessions = vi.spyOn(projectRepository, 'listProjectSessions')

    const { result } = renderHook(() => useProjectSessions(''), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(sessions).not.toHaveBeenCalled()
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
