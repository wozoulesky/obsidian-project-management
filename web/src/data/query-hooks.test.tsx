import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Task, TaskStatus } from './domain'
import {
  ProjectRepositoryProvider,
  projectId,
  projectOwnedQueryKeys,
  projectQueryKeys,
  projectRepository,
  useAllTasks,
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
  useProjectTasks,
  useProjectRepository,
  useProjects,
  useImportData,
  useMoveTaskStatus,
  useRestoreBackup,
  useTasks,
  useUpdateRequirementStatus,
  useUpdateTaskDates,
  useUpdateTaskProgress,
  useWorkspaceDashboard,
  workspaceProjectStorageKey,
} from './query-hooks'
import { createMockProjectRepository } from './mock-project-repository'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createDeferredResult<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

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

  it('refetches active aggregates without refetching the deleted scope', async () => {
    const repository = createMockProjectRepository()
    const { queryClient, wrapper } = createDeleteHarness(
      repository,
      'project_default',
    )
    const [atlas, allTasks, dashboard] = await Promise.all([
      repository.getProject('atlas'),
      repository.listAllTasks(),
      repository.getWorkspaceDashboard(7),
    ])
    queryClient.setQueryData(projectQueryKeys.projects, [atlas])
    queryClient.setQueryData(projectQueryKeys.allTasks, allTasks)
    queryClient.setQueryData(
      projectQueryKeys.workspaceDashboardFor(7),
      dashboard,
    )
    queryClient.setQueryData(projectQueryKeys.projectFor('atlas'), atlas)
    const listProjects = vi.spyOn(repository, 'listProjects')
    const listAllTasks = vi.spyOn(repository, 'listAllTasks')
    const getWorkspaceDashboard = vi.spyOn(
      repository,
      'getWorkspaceDashboard',
    )
    const getProject = vi.spyOn(repository, 'getProject')
    const { result } = renderHook(() => ({
      projects: useProjects(),
      allTasks: useAllTasks(),
      dashboard: useWorkspaceDashboard(7),
      deletedProject: useProject('atlas'),
      deletion: useDeleteProject(),
    }), { wrapper })
    expect(listProjects).not.toHaveBeenCalled()
    expect(listAllTasks).not.toHaveBeenCalled()
    expect(getWorkspaceDashboard).not.toHaveBeenCalled()
    expect(getProject).not.toHaveBeenCalled()

    await act(() => result.current.deletion.mutateAsync({
      projectId: 'atlas',
      version: 1,
    }))

    expect(listProjects).toHaveBeenCalledTimes(1)
    expect(listAllTasks).toHaveBeenCalledTimes(1)
    expect(getWorkspaceDashboard).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.projects.data).toEqual([]))
    await waitFor(() => expect(result.current.allTasks.data).toEqual([]))
    await waitFor(() => expect(
      result.current.dashboard.data?.metrics.totalTasks,
    ).toBe(0))
    expect(result.current.deletedProject.fetchStatus).toBe('idle')
    expect(result.current.deletedProject.error).toBeNull()
    expect(getProject).not.toHaveBeenCalled()
  })

  it('keeps all-task aggregate separate from a project named all', async () => {
    const repository = createMockProjectRepository()
    const atlas = await repository.getProject('atlas')
    const baseTask = (await repository.listAllTasks())[0]!
    const deletedTask = {
      ...baseTask,
      id: 'all-task',
      code: 'ALL-TASK',
      projectId: 'all',
    }
    const survivingTask = {
      ...baseTask,
      id: 'other-task',
      code: 'OTHER-TASK',
      projectId: 'other',
    }
    const projectAll = { ...atlas, id: 'all', code: 'ALL', name: 'All' }
    const otherProject = {
      ...atlas,
      id: 'other',
      code: 'OTHER',
      name: 'Other',
    }
    vi.spyOn(repository, 'deleteProject').mockResolvedValue({
      id: 'all',
      name: 'All',
      deletedAt: '2026-08-02T04:00:00.000Z',
      deletedCounts: {
        project_members: 1,
        tasks: 1,
        requirements: 0,
        defects: 0,
        sessions: 0,
        handoffs: 0,
        deliverables: 0,
      },
    })
    const listAllTasks = vi.spyOn(repository, 'listAllTasks')
      .mockResolvedValue([survivingTask])
    const listTasks = vi.spyOn(repository, 'listTasks')
      .mockResolvedValue([deletedTask])
    const { queryClient, wrapper } = createDeleteHarness(repository, 'other')
    queryClient.setQueryData(projectQueryKeys.projects, [
      projectAll,
      otherProject,
    ])
    queryClient.setQueryData(projectQueryKeys.allTasks, [
      deletedTask,
      survivingTask,
    ])
    queryClient.setQueryData(projectQueryKeys.tasksFor('all'), [deletedTask])
    const { result } = renderHook(() => ({
      allTasks: useAllTasks(),
      scopedTasks: useProjectTasks('all'),
      deletion: useDeleteProject(),
    }), { wrapper })

    await act(() => result.current.deletion.mutateAsync({
      projectId: 'all',
      version: 1,
    }))

    await waitFor(() => expect(result.current.allTasks.data).toEqual([
      survivingTask,
    ]))
    expect(queryClient.getQueryData(projectQueryKeys.allTasks)).toEqual([
      survivingTask,
    ])
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('all')))
      .toBeUndefined()
    expect(result.current.scopedTasks.data).toBeUndefined()
    expect(result.current.scopedTasks.fetchStatus).toBe('idle')
    expect(listAllTasks).toHaveBeenCalledTimes(1)
    expect(listTasks).not.toHaveBeenCalled()
    expect(projectQueryKeys.allTasks).not.toEqual(
      projectQueryKeys.tasksFor('all'),
    )
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

  it('does not overwrite a project selected while deletion is pending', async () => {
    const repository = createMockProjectRepository()
    const atlas = await repository.getProject('atlas')
    const projectB = await repository.createProject({
      name: 'B',
      description: '',
      ownerId: atlas.ownerId,
      startDate: null,
      dueDate: null,
    })
    const projectC = await repository.createProject({
      name: 'C',
      description: '',
      ownerId: atlas.ownerId,
      startDate: null,
      dueDate: null,
    })
    const deferred = createDeferred()
    const realDeleteProject = repository.deleteProject.bind(repository)
    vi.spyOn(repository, 'deleteProject').mockImplementation(
      async (selectedProjectId, version) => {
        await deferred.promise
        return realDeleteProject(selectedProjectId, version)
      },
    )
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.projects, [
      atlas,
      projectC,
      projectB,
    ])
    sessionStorage.setItem(workspaceProjectStorageKey, 'atlas')
    const { result } = renderHook(() => ({
      deletion: useDeleteProject(),
      selection: useProjectRepository(),
    }), { wrapper })

    await act(async () => {
      const pending = result.current.deletion.mutateAsync({
        projectId: 'atlas',
        version: atlas.version,
      })
      result.current.selection.selectProject(projectB.id)
      deferred.resolve()
      await pending
    })

    expect(result.current.selection.projectId).toBe(projectB.id)
    expect(sessionStorage.getItem(workspaceProjectStorageKey)).toBe(projectB.id)
  })

  it('migrates when the user selects the deleting project while pending', async () => {
    const repository = createMockProjectRepository()
    const atlas = await repository.getProject('atlas')
    const projectB = await repository.createProject({
      name: 'B',
      description: '',
      ownerId: atlas.ownerId,
      startDate: null,
      dueDate: null,
    })
    const projectC = await repository.createProject({
      name: 'C',
      description: '',
      ownerId: atlas.ownerId,
      startDate: null,
      dueDate: null,
    })
    const deferred = createDeferred()
    const realDeleteProject = repository.deleteProject.bind(repository)
    vi.spyOn(repository, 'deleteProject').mockImplementation(
      async (selectedProjectId, version) => {
        await deferred.promise
        return realDeleteProject(selectedProjectId, version)
      },
    )
    const { queryClient, wrapper } = createDeleteHarness(repository, projectB.id)
    queryClient.setQueryData(projectQueryKeys.projects, [
      atlas,
      projectC,
      projectB,
    ])
    sessionStorage.setItem(workspaceProjectStorageKey, projectB.id)
    const { result } = renderHook(() => ({
      deletion: useDeleteProject(),
      selection: useProjectRepository(),
    }), { wrapper })

    await act(async () => {
      const pending = result.current.deletion.mutateAsync({
        projectId: 'atlas',
        version: atlas.version,
      })
      result.current.selection.selectProject('atlas')
      deferred.resolve()
      await pending
    })

    expect(result.current.selection.projectId).toBe(projectC.id)
    expect(sessionStorage.getItem(workspaceProjectStorageKey)).toBe(projectC.id)
  })

  it.each([
    ['atlas', 'project-b'],
    ['project-b', 'atlas'],
  ] as const)(
    'keeps concurrent deletion order %s then %s from restoring a deleted selection',
    async (firstCompletedId, secondCompletedId) => {
      const repository = createMockProjectRepository()
      const atlas = await repository.getProject('atlas')
      const projectB = await repository.createProject({
        name: 'B',
        description: '',
        ownerId: atlas.ownerId,
        startDate: null,
        dueDate: null,
      })
      const projectC = await repository.createProject({
        name: 'C',
        description: '',
        ownerId: atlas.ownerId,
        startDate: null,
        dueDate: null,
      })
      const deferredById = new Map([
        ['atlas', createDeferred()],
        [projectB.id, createDeferred()],
      ])
      const realDeleteProject = repository.deleteProject.bind(repository)
      vi.spyOn(repository, 'deleteProject').mockImplementation(
        async (selectedProjectId, version) => {
          await deferredById.get(selectedProjectId)!.promise
          return realDeleteProject(selectedProjectId, version)
        },
      )
      const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
      queryClient.setQueryData(projectQueryKeys.projects, [
        atlas,
        projectB,
        projectC,
      ])
      sessionStorage.setItem(workspaceProjectStorageKey, 'atlas')
      const { result } = renderHook(() => ({
        deletionA: useDeleteProject(),
        deletionB: useDeleteProject(),
        selection: useProjectRepository(),
      }), { wrapper })
      const idByLabel = { atlas: 'atlas', 'project-b': projectB.id }

      await act(async () => {
        const pendingById = new Map([
          ['atlas', result.current.deletionA.mutateAsync({
            projectId: 'atlas',
            version: atlas.version,
          })],
          [projectB.id, result.current.deletionB.mutateAsync({
            projectId: projectB.id,
            version: projectB.version,
          })],
        ])
        result.current.selection.selectProject(projectB.id)
        const firstId = idByLabel[firstCompletedId]
        deferredById.get(firstId)!.resolve()
        await pendingById.get(firstId)
        const secondId = idByLabel[secondCompletedId]
        deferredById.get(secondId)!.resolve()
        await pendingById.get(secondId)
      })

      expect(result.current.selection.projectId).toBe(projectC.id)
      expect(sessionStorage.getItem(workspaceProjectStorageKey))
        .toBe(projectC.id)
    },
  )

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

  it('re-enables a scoped query when creation restores the same id', async () => {
    const repository = createMockProjectRepository()
    const atlas = await repository.getProject('atlas')
    const otherProject = await repository.createProject({
      name: 'Borealis',
      description: '',
      ownerId: atlas.ownerId,
      startDate: null,
      dueDate: null,
    })
    const { wrapper } = createDeleteHarness(
      repository,
      'project_default',
    )
    const deletion = renderHook(() => useDeleteProject(), { wrapper })
    await act(() => deletion.result.current.mutateAsync({
      projectId: 'atlas',
      version: 1,
    }))
    await act(() => deletion.result.current.mutateAsync({
      projectId: otherProject.id,
      version: otherProject.version,
    }))
    const restoredAtlas = { ...atlas, name: 'Restored Atlas' }
    vi.spyOn(repository, 'createProject').mockResolvedValue(restoredAtlas)
    const getProject = vi.spyOn(repository, 'getProject')
      .mockImplementation(async (selectedProjectId) => {
        if (selectedProjectId === 'atlas') return restoredAtlas
        throw new Error(`Project not found: ${selectedProjectId}`)
      })
    const project = renderHook(() => useProject('atlas'), { wrapper })
    const otherProjectHook = renderHook(
      () => useProject(otherProject.id),
      { wrapper },
    )
    const creation = renderHook(() => useCreateProject(), { wrapper })
    expect(project.result.current.fetchStatus).toBe('idle')
    expect(otherProjectHook.result.current.fetchStatus).toBe('idle')
    expect(getProject).not.toHaveBeenCalled()

    await act(() => creation.result.current.mutateAsync({
      name: 'Restored Atlas',
      description: '',
      ownerId: atlas.ownerId,
      startDate: atlas.startDate,
      dueDate: atlas.dueDate,
    }))

    await waitFor(() => expect(getProject).toHaveBeenCalledWith('atlas'))
    expect(getProject).toHaveBeenCalledTimes(1)
    expect(project.result.current.data).toEqual(restoredAtlas)
    expect(otherProjectHook.result.current.fetchStatus).toBe('idle')
    expect(otherProjectHook.result.current.error).toBeNull()
  })

  it.each([
    {
      remainingIds: ['borealis'],
      expectedSelection: 'borealis',
    },
    {
      remainingIds: [] as string[],
      expectedSelection: '',
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
      if (expectedSelection === '') {
        expect(sessionStorage.getItem(workspaceProjectStorageKey)).toBeNull()
      } else {
        expect(sessionStorage.getItem(workspaceProjectStorageKey))
          .toBe(expectedSelection)
      }
    },
  )
})

describe('optimistic task status moves', () => {
  const moveInvalidationKeys = (selectedProjectId: string) => [
    projectQueryKeys.tasksFor(selectedProjectId),
    projectQueryKeys.allTasks,
    projectQueryKeys.ganttFor(selectedProjectId),
    projectQueryKeys.requirementsFor(selectedProjectId),
    projectQueryKeys.dashboardFor(selectedProjectId, 7),
    projectQueryKeys.workspaceDashboardFor(7),
    projectQueryKeys.projectFor(selectedProjectId),
    projectQueryKeys.projects,
    projectQueryKeys.activities,
  ] as const

  function seedMoveInvalidationCaches(
    queryClient: QueryClient,
    selectedProjectId: string,
  ) {
    for (const queryKey of moveInvalidationKeys(selectedProjectId)) {
      if (queryClient.getQueryState(queryKey) === undefined) {
        queryClient.setQueryData(queryKey, { seeded: true })
      }
    }
  }

  function expectMoveCachesInvalidated(
    queryClient: QueryClient,
    selectedProjectId: string,
  ) {
    for (const queryKey of moveInvalidationKeys(selectedProjectId)) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  }

  it('cancels only matching canonical task lists before updating them', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const task = { ...tasks[0], version: 7 }
    const otherTask = { ...tasks[1], id: 'other-task' }
    const projectTasks = [task, otherTask]
    const allTasks = [{ ...task, progress: 17 }, otherTask]
    const filteredTasks = [otherTask, { ...task, progress: 64 }]
    const filteredKey = ['tasks', 'atlas', { assignee: 'human-lin' }] as const
    const metadataKey = ['tasks', 'atlas', 'metadata'] as const
    const arrayMetadataKey = ['tasks', 'atlas', 'metadata-array'] as const
    const metadata = { total: 2 }
    const arrayMetadata = [task]
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), projectTasks)
    queryClient.setQueryData(projectQueryKeys.allTasks, allTasks)
    queryClient.setQueryData(filteredKey, filteredTasks)
    queryClient.setQueryData(metadataKey, metadata, { updatedAt: 404 })
    queryClient.setQueryData(arrayMetadataKey, arrayMetadata)
    seedMoveInvalidationCaches(queryClient, 'atlas')
    const cancellation = createDeferred()
    const serverResponse = createDeferredResult<Task>()
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
      .mockReturnValue(cancellation.promise)
    const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
      .mockReturnValue(serverResponse.promise)
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })
    let mutation!: Promise<Task>

    act(() => {
      mutation = result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task,
      })
    })

    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(3))
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.tasksFor('atlas'),
      exact: true,
    })
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.allTasks,
      exact: true,
    })
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: filteredKey,
      exact: true,
    })
    expect(cancelQueries).not.toHaveBeenCalledWith({
      queryKey: metadataKey,
      exact: true,
    })
    expect(cancelQueries).not.toHaveBeenCalledWith({
      queryKey: arrayMetadataKey,
      exact: true,
    })
    expect(cancelQueries).not.toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('atlas')))
      .toBe(projectTasks)
    expect(updateTaskProgress).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(metadataKey)).toBe(metadata)
    expect(queryClient.getQueryData(arrayMetadataKey)).toBe(arrayMetadata)

    await act(async () => {
      cancellation.resolve()
      await Promise.resolve()
    })
    await waitFor(() => expect(updateTaskProgress).toHaveBeenCalledWith(
      task.id,
      {
        progress: 100,
        status: 'done',
        note: 'Moved to done from task board',
        version: task.version,
      },
    ))

    for (const queryKey of [
      projectQueryKeys.tasksFor('atlas'),
      projectQueryKeys.allTasks,
      filteredKey,
    ]) {
      const cachedTasks = queryClient.getQueryData<Task[]>(queryKey)
      expect(cachedTasks?.find(({ id }) => id === task.id)).toMatchObject({
        status: 'done',
        progress: 100,
        version: task.version,
      })
      expect(cachedTasks?.find(({ id }) => id === otherTask.id))
        .toBe(otherTask)
    }
    expect(queryClient.getQueryData(metadataKey)).toBe(metadata)
    expect(queryClient.getQueryState(metadataKey)?.dataUpdatedAt).toBe(404)
    expect(queryClient.getQueryData(arrayMetadataKey)).toBe(arrayMetadata)

    const returnedTask = { ...task, status: 'done' as const, progress: 100,
      version: 99 }
    await act(async () => {
      serverResponse.resolve(returnedTask)
      await expect(mutation).resolves.toEqual(returnedTask)
    })
    expectMoveCachesInvalidated(queryClient, 'atlas')
  })

  it('does not cancel an active task fetch for another project', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const task = { ...tasks[0], projectId: 'atlas', version: 9 }
    const borealisTask = {
      ...tasks[1],
      id: 'borealis-task',
      projectId: 'borealis',
    }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), [task])
    const borealisResponse = createDeferredResult<Task[]>()
    const borealisFetch = queryClient.fetchQuery({
      queryKey: projectQueryKeys.tasksFor('borealis'),
      queryFn: () => borealisResponse.promise,
      staleTime: 0,
    })
    const observedBorealisFetch = borealisFetch.then(
      (data) => ({ data }),
      (error: unknown) => ({ error }),
    )
    await waitFor(() => expect(queryClient.getQueryState(
      projectQueryKeys.tasksFor('borealis'),
    )?.fetchStatus).toBe('fetching'))
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    vi.spyOn(repository, 'updateTaskProgress').mockResolvedValue({
      ...task,
      status: 'done',
      progress: 100,
    })
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

    await act(() => result.current.mutateAsync({
      projectId: 'atlas',
      status: 'done',
      task,
    }))
    const fetchStatusBeforeResolution = queryClient.getQueryState(
      projectQueryKeys.tasksFor('borealis'),
    )?.fetchStatus
    borealisResponse.resolve([borealisTask])
    const outcome = await observedBorealisFetch

    expect(fetchStatusBeforeResolution).toBe('fetching')
    expect(outcome).toEqual({ data: [borealisTask] })
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('borealis')))
      .toEqual([borealisTask])
    expect(cancelQueries).not.toHaveBeenCalledWith({
      queryKey: projectQueryKeys.tasksFor('borealis'),
      exact: true,
    })
  })

  it('restores exact task snapshots after a rejected move', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const task = { ...tasks[0], version: 11 }
    const otherTask = { ...tasks[1], id: 'rollback-other' }
    const projectTasks = [task, otherTask]
    const allTasks = [otherTask, { ...task, progress: 46, version: 23 }]
    const filteredTasks = [{ ...task, progress: 88, version: 41 }]
    const filteredKey = ['tasks', 'atlas', { status: 'open' }] as const
    const metadataKey = ['tasks', 'metadata'] as const
    const emptyKey = ['tasks', 'empty'] as const
    const unrelatedKey = ['settings', 'move-test'] as const
    const metadata = { total: 2 }
    const unrelated = { theme: 'dark' }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(
      projectQueryKeys.tasksFor('atlas'),
      projectTasks,
      { updatedAt: 101 },
    )
    queryClient.setQueryData(projectQueryKeys.allTasks, allTasks, {
      updatedAt: 202,
    })
    queryClient.setQueryData(filteredKey, filteredTasks, { updatedAt: 303 })
    queryClient.setQueryData(metadataKey, metadata, { updatedAt: 404 })
    queryClient.setQueryData(unrelatedKey, unrelated, { updatedAt: 505 })
    queryClient.getQueryCache().build(queryClient, {
      queryKey: emptyKey,
      queryFn: async () => [] as Task[],
    })
    seedMoveInvalidationCaches(queryClient, 'atlas')
    const snapshots = [
      projectQueryKeys.tasksFor('atlas'),
      projectQueryKeys.allTasks,
      filteredKey,
    ].map((queryKey) => ({
      queryKey,
      data: queryClient.getQueryData(queryKey),
      state: queryClient.getQueryState(queryKey),
    }))
    const emptyState = queryClient.getQueryState(emptyKey)
    const rejection = createDeferredResult<Task>()
    vi.spyOn(repository, 'updateTaskProgress').mockReturnValue(rejection.promise)
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })
    let mutation!: Promise<Task>

    act(() => {
      mutation = result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task,
      })
    })
    const observedMutation = mutation.catch((error: unknown) => error)
    await waitFor(() => expect(
      queryClient.getQueryData<Task[]>(filteredKey)?.[0].status,
    ).toBe('done'))

    const error = new Error('move rejected')
    await act(async () => {
      rejection.reject(error)
      await observedMutation
    })
    await expect(observedMutation).resolves.toBe(error)

    for (const snapshot of snapshots) {
      expect(queryClient.getQueryData(snapshot.queryKey)).toBe(snapshot.data)
      expect(queryClient.getQueryState(snapshot.queryKey)?.dataUpdatedAt)
        .toBe(snapshot.state?.dataUpdatedAt)
      expect(queryClient.getQueryState(snapshot.queryKey)?.dataUpdateCount)
        .toBe(snapshot.state?.dataUpdateCount)
    }
    expect(queryClient.getQueryData<Task[]>(projectQueryKeys.tasksFor('atlas'))
      ?.[0]).toMatchObject({
        status: task.status,
        progress: task.progress,
        version: task.version,
      })
    expect(queryClient.getQueryData(metadataKey)).toBe(metadata)
    expect(queryClient.getQueryState(metadataKey)?.dataUpdatedAt).toBe(404)
    expect(queryClient.getQueryData(emptyKey)).toBeUndefined()
    expect(queryClient.getQueryState(emptyKey)?.dataUpdatedAt)
      .toBe(emptyState?.dataUpdatedAt)
    expect(queryClient.getQueryData(unrelatedKey)).toBe(unrelated)
    expect(queryClient.getQueryState(unrelatedKey)).toMatchObject({
      dataUpdatedAt: 505,
      isInvalidated: false,
    })
    expectMoveCachesInvalidated(queryClient, 'atlas')
  })

  it('keeps authoritative refetch data when a pending move later fails', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, projectId: 'atlas', version: 29 }
    const queryKey = projectQueryKeys.tasksFor('atlas')
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(queryKey, [task], { updatedAt: 101 })
    const rejection = createDeferredResult<Task>()
    vi.spyOn(repository, 'updateTaskProgress').mockReturnValue(rejection.promise)
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })
    let mutation!: Promise<Task>

    act(() => {
      mutation = result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task,
      })
    })
    const observedMutation = mutation.catch((error: unknown) => error)
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(queryKey)?.[0])
      .toMatchObject({ status: 'done', progress: 100 }))
    const optimisticData = queryClient.getQueryData<Task[]>(queryKey)
    const optimisticState = queryClient.getQueryState(queryKey)!
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(
      optimisticState.dataUpdatedAt + 1_000,
    )
    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => optimisticData?.map((candidate) => ({
        ...candidate,
      })) ?? [],
      staleTime: 0,
    })
    dateNow.mockRestore()
    const refetchedState = queryClient.getQueryState(queryKey)!
    expect(refetchedState.data).toBe(optimisticData)
    expect(refetchedState.dataUpdateCount)
      .toBeGreaterThan(optimisticState.dataUpdateCount)
    expect(refetchedState.dataUpdatedAt)
      .toBeGreaterThan(optimisticState.dataUpdatedAt)

    await act(async () => {
      rejection.reject(new Error('move failed after refetch'))
      await observedMutation
    })

    const settledState = queryClient.getQueryState(queryKey)!
    expect(settledState.data).toBe(refetchedState.data)
    expect(settledState.dataUpdateCount).toBe(refetchedState.dataUpdateCount)
    expect(settledState.dataUpdatedAt).toBe(refetchedState.dataUpdatedAt)
  })

  it('preserves query state changes that happen after the optimistic write', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, projectId: 'atlas', version: 31 }
    const filteredKey = ['tasks', 'atlas', { assignee: 'agent-1' }] as const
    const originalTasks = [task]
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(filteredKey, originalTasks, { updatedAt: 303 })
    const rejection = createDeferredResult<Task>()
    vi.spyOn(repository, 'updateTaskProgress').mockReturnValue(rejection.promise)
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })
    let mutation!: Promise<Task>

    act(() => {
      mutation = result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task,
      })
    })
    const observedMutation = mutation.catch((error: unknown) => error)
    await waitFor(() => expect(
      queryClient.getQueryData<Task[]>(filteredKey)?.[0].status,
    ).toBe('done'))
    const interveningError = new Error('background fetch failed')
    queryClient.getQueryCache().find({
      queryKey: filteredKey,
      exact: true,
    })!.setState({
      error: interveningError,
      fetchStatus: 'fetching',
      isInvalidated: true,
      status: 'error',
    })

    await act(async () => {
      rejection.reject(new Error('move rejected'))
      await observedMutation
    })

    expect(queryClient.getQueryData(filteredKey)).toBe(originalTasks)
    expect(queryClient.getQueryState(filteredKey)).toMatchObject({
      dataUpdatedAt: 303,
      error: interveningError,
      fetchStatus: 'fetching',
      isInvalidated: true,
      status: 'error',
    })
  })

  it.each([
    { status: 'not_started', currentProgress: 73, expectedProgress: 0 },
    { status: 'in_progress', currentProgress: 0, expectedProgress: 1 },
    { status: 'overdue', currentProgress: 100, expectedProgress: 99 },
  ] satisfies Array<{
    status: TaskStatus
    currentProgress: number
    expectedProgress: number
  }>)(
    'normalizes progress when moving a task to $status',
    async ({ status, currentProgress, expectedProgress }) => {
      const repository = createMockProjectRepository()
      const [fixtureTask] = await repository.listTasks('atlas')
      const task = { ...fixtureTask, progress: currentProgress, version: 13 }
      const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
      queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), [task])
      const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
        .mockResolvedValue({ ...task, status, progress: expectedProgress })
      const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

      await act(() => result.current.mutateAsync({
        projectId: 'atlas',
        status,
        task,
      }))

      expect(updateTaskProgress).toHaveBeenCalledWith(task.id, {
        progress: expectedProgress,
        status,
        note: `Moved to ${status} from task board`,
        version: task.version,
      })
      expect(queryClient.getQueryData<Task[]>(
        projectQueryKeys.tasksFor('atlas'),
      )?.[0]).toMatchObject({
        status,
        progress: expectedProgress,
        version: task.version,
      })
    },
  )

  it('allows only one pending move per task across hook instances', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, projectId: 'atlas', version: 17 }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), [task])
    const firstResponse = createDeferredResult<Task>()
    const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce({ ...task, status: 'in_progress', progress: 99 })
    const firstHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    const secondHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    let firstMutation!: Promise<Task>

    act(() => {
      firstMutation = firstHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task,
      })
    })
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.[0].status).toBe('done'))
    const pendingCache = queryClient.getQueryData(
      projectQueryKeys.tasksFor('atlas'),
    )
    const pendingCount = queryClient.getQueryState(
      projectQueryKeys.tasksFor('atlas'),
    )?.dataUpdateCount

    await expect(secondHook.result.current.mutateAsync({
      projectId: 'atlas',
      status: 'in_progress',
      task,
    })).rejects.toThrow(`Task ${task.id} already has a pending status move`)
    await expect(secondHook.result.current.mutateAsync({
      projectId: 'atlas',
      status: 'overdue',
      task,
    })).rejects.toThrow(`Task ${task.id} already has a pending status move`)
    expect(updateTaskProgress).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('atlas')))
      .toBe(pendingCache)
    expect(queryClient.getQueryState(
      projectQueryKeys.tasksFor('atlas'),
    )?.dataUpdateCount).toBe(pendingCount)

    await act(async () => {
      firstResponse.resolve({ ...task, status: 'done', progress: 100 })
      await firstMutation
    })
    await act(() => secondHook.result.current.mutateAsync({
      projectId: 'atlas',
      status: 'in_progress',
      task: queryClient.getQueryData<Task[]>(
        projectQueryKeys.tasksFor('atlas'),
      )![0],
    }))
    expect(updateTaskProgress).toHaveBeenCalledTimes(2)
  })

  it('releases its task guard when cancellation fails', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, projectId: 'atlas', version: 19 }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), [task])
    vi.spyOn(queryClient, 'cancelQueries')
      .mockRejectedValueOnce(new Error('cancel failed'))
      .mockResolvedValueOnce()
    const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
      .mockResolvedValue({ ...task, status: 'done', progress: 100 })
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

    await expect(result.current.mutateAsync({
      projectId: 'atlas',
      status: 'done',
      task,
    })).rejects.toThrow('cancel failed')
    await act(() => result.current.mutateAsync({
      projectId: 'atlas',
      status: 'done',
      task,
    }))

    expect(updateTaskProgress).toHaveBeenCalledTimes(1)
  })

  it('keeps the server version usable when invalidation fails', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = {
      ...fixtureTask,
      projectId: 'atlas',
      updatedAt: '2026-08-03T10:00:00.000',
      version: 20,
    }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), [task])
    const invalidationError = new Error('invalidation failed')
    vi.spyOn(queryClient, 'invalidateQueries')
      .mockRejectedValueOnce(invalidationError)
    let serverTask = task
    const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
      .mockImplementation(async (_taskId, input) => {
        if (input.version !== serverTask.version) {
          throw new Error(
            `Version conflict: expected ${serverTask.version}, received ${input.version}`,
          )
        }
        serverTask = {
          ...serverTask,
          progress: input.progress,
          status: input.status,
          updatedAt: `2026-08-03T10:00:0${serverTask.version - 19}.000`,
          version: serverTask.version + 1,
        }
        return serverTask
      })
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

    await expect(result.current.mutateAsync({
      projectId: 'atlas',
      status: 'done',
      task,
    })).rejects.toBe(invalidationError)
    const firstServerTask = queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )![0]
    expect(firstServerTask).toMatchObject({
      status: 'done',
      updatedAt: '2026-08-03T10:00:01.000',
      version: 21,
    })
    await act(() => result.current.mutateAsync({
      projectId: 'atlas',
      status: 'in_progress',
      task: firstServerTask,
    }))

    expect(updateTaskProgress).toHaveBeenCalledTimes(2)
    expect(updateTaskProgress.mock.calls.map(([, input]) => input.version))
      .toEqual([20, 21])
    expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.[0]).toMatchObject({
      status: 'in_progress',
      updatedAt: '2026-08-03T10:00:02.000',
      version: 22,
    })
  })

  it('allows different tasks to move concurrently', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const firstTask = { ...tasks[0], projectId: 'atlas', version: 21 }
    const secondTask = { ...tasks[1], projectId: 'atlas', version: 22 }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(
      projectQueryKeys.tasksFor('atlas'),
      [firstTask, secondTask],
    )
    const firstResponse = createDeferredResult<Task>()
    const secondResponse = createDeferredResult<Task>()
    const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
      .mockImplementation((taskId) => taskId === firstTask.id
        ? firstResponse.promise
        : secondResponse.promise)
    const firstHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    const secondHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    let firstMutation!: Promise<Task>
    let secondMutation!: Promise<Task>

    act(() => {
      firstMutation = firstHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task: firstTask,
      })
    })
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.map(({ status }) => status)).toEqual(['done', secondTask.status]))
    act(() => {
      secondMutation = secondHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'overdue',
        task: secondTask,
      })
    })
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )).toEqual([
      expect.objectContaining({ status: 'done', progress: 100 }),
      expect.objectContaining({ status: 'overdue' }),
    ]))
    expect(updateTaskProgress).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstResponse.resolve({ ...firstTask, status: 'done', progress: 100 })
      secondResponse.resolve({
        ...secondTask,
        status: 'overdue',
        progress: secondTask.progress,
      })
      await Promise.all([firstMutation, secondMutation])
    })
  })

  it('rolls back two failed task moves independently in shared caches', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const firstTask = { ...tasks[0], projectId: 'atlas', version: 25 }
    const secondTask = { ...tasks[1], projectId: 'atlas', version: 26 }
    const originalTasks = [firstTask, secondTask]
    const filteredKey = ['tasks', 'atlas', { status: 'open' }] as const
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    for (const queryKey of [
      projectQueryKeys.tasksFor('atlas'),
      projectQueryKeys.allTasks,
      filteredKey,
    ]) {
      queryClient.setQueryData(queryKey, originalTasks)
    }
    const firstResponse = createDeferredResult<Task>()
    const secondResponse = createDeferredResult<Task>()
    vi.spyOn(repository, 'updateTaskProgress')
      .mockImplementation((taskId) => taskId === firstTask.id
        ? firstResponse.promise
        : secondResponse.promise)
    const firstHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    const secondHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    let firstMutation!: Promise<Task>
    let secondMutation!: Promise<Task>

    act(() => {
      firstMutation = firstHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task: firstTask,
      })
    })
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.map(({ status }) => status)).toEqual([
      'done',
      secondTask.status,
    ]))
    act(() => {
      secondMutation = secondHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'overdue',
        task: secondTask,
      })
    })
    const observedFirst = firstMutation.catch((error: unknown) => error)
    const observedSecond = secondMutation.catch((error: unknown) => error)
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )).toEqual([
      expect.objectContaining({ status: 'done' }),
      expect.objectContaining({ status: 'overdue' }),
    ]))

    await act(async () => {
      firstResponse.reject(new Error('first failed'))
      await observedFirst
    })
    await act(async () => {
      secondResponse.reject(new Error('second failed'))
      await observedSecond
    })

    for (const queryKey of [
      projectQueryKeys.tasksFor('atlas'),
      projectQueryKeys.allTasks,
      filteredKey,
    ]) {
      const cachedTasks = queryClient.getQueryData<Task[]>(queryKey)
      expect(cachedTasks?.[0]).toBe(firstTask)
      expect(cachedTasks?.[1]).toBe(secondTask)
    }
  })

  it('rolls back one failed task without replacing another server result', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const firstTask = { ...tasks[0], projectId: 'atlas', version: 27 }
    const secondTask = { ...tasks[1], projectId: 'atlas', version: 28 }
    const originalTasks = [firstTask, secondTask]
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), originalTasks)
    queryClient.setQueryData(projectQueryKeys.allTasks, originalTasks)
    const firstResponse = createDeferredResult<Task>()
    const secondResponse = createDeferredResult<Task>()
    vi.spyOn(repository, 'updateTaskProgress')
      .mockImplementation((taskId) => taskId === firstTask.id
        ? firstResponse.promise
        : secondResponse.promise)
    const firstHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    const secondHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    let firstMutation!: Promise<Task>
    let secondMutation!: Promise<Task>

    act(() => {
      firstMutation = firstHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task: firstTask,
      })
      secondMutation = secondHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'overdue',
        task: secondTask,
      })
    })
    const observedFirst = firstMutation.catch((error: unknown) => error)
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.map(({ status }) => status)).toEqual(['done', 'overdue']))
    await act(async () => {
      firstResponse.reject(new Error('first failed'))
      await observedFirst
    })
    const serverSecondTask = {
      ...secondTask,
      status: 'overdue' as const,
      progress: 73,
      version: 99,
      updatedAt: '2026-08-03T12:00:00.000',
    }
    await act(async () => {
      secondResponse.resolve(serverSecondTask)
      await secondMutation
    })

    for (const queryKey of [
      projectQueryKeys.tasksFor('atlas'),
      projectQueryKeys.allTasks,
    ]) {
      const cachedTasks = queryClient.getQueryData<Task[]>(queryKey)
      expect(cachedTasks?.[0]).toBe(firstTask)
      expect(cachedTasks?.[1]).toBe(serverSecondTask)
    }
  })

  it('waits for the final related move before refetching active task lists', async () => {
    const repository = createMockProjectRepository()
    const tasks = await repository.listTasks('atlas')
    const firstTask = { ...tasks[0], projectId: 'atlas', version: 31 }
    const secondTask = {
      ...tasks[1],
      projectId: 'atlas',
      status: 'not_started' as const,
      progress: 0,
      version: 32,
    }
    const originalTasks = [firstTask, secondTask]
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), originalTasks)
    queryClient.setQueryData(projectQueryKeys.allTasks, originalTasks)
    const projectRefetches: Array<ReturnType<
      typeof createDeferredResult<Task[]>
    >> = []
    const allTaskRefetches: Array<ReturnType<
      typeof createDeferredResult<Task[]>
    >> = []
    vi.spyOn(repository, 'listTasks').mockImplementation(() => {
      const request = createDeferredResult<Task[]>()
      projectRefetches.push(request)
      return request.promise
    })
    vi.spyOn(repository, 'listAllTasks').mockImplementation(() => {
      const request = createDeferredResult<Task[]>()
      allTaskRefetches.push(request)
      return request.promise
    })
    renderHook(() => ({
      allTasks: useAllTasks(),
      projectTasks: useProjectTasks('atlas'),
    }), { wrapper })
    const firstResponse = createDeferredResult<Task>()
    const secondResponse = createDeferredResult<Task>()
    vi.spyOn(repository, 'updateTaskProgress')
      .mockImplementation((taskId) => taskId === firstTask.id
        ? firstResponse.promise
        : secondResponse.promise)
    const firstHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    const secondHook = renderHook(() => useMoveTaskStatus(), { wrapper })
    let firstMutation!: Promise<Task>
    let secondMutation!: Promise<Task>

    act(() => {
      firstMutation = firstHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'done',
        task: firstTask,
      })
      secondMutation = secondHook.result.current.mutateAsync({
        projectId: 'atlas',
        status: 'overdue',
        task: secondTask,
      })
    })
    await waitFor(() => expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.map(({ status }) => status)).toEqual(['done', 'overdue']))
    const serverFirstTask = {
      ...firstTask,
      status: 'done' as const,
      progress: 100,
      version: 33,
    }
    await act(async () => {
      firstResponse.resolve(serverFirstTask)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const earlyProjectRefetchCount = projectRefetches.length
    const earlyAllTaskRefetchCount = allTaskRefetches.length
    await act(async () => {
      for (const request of projectRefetches) {
        request.resolve([serverFirstTask, secondTask])
      }
      for (const request of allTaskRefetches) {
        request.resolve([serverFirstTask, secondTask])
      }
      await firstMutation
    })

    expect(earlyProjectRefetchCount).toBe(0)
    expect(earlyAllTaskRefetchCount).toBe(0)
    expect(queryClient.getQueryData<Task[]>(
      projectQueryKeys.tasksFor('atlas'),
    )?.[1]).toMatchObject({ status: 'overdue' })

    const serverSecondTask = {
      ...secondTask,
      status: 'overdue' as const,
      progress: 1,
      version: 34,
    }
    await act(async () => {
      secondResponse.resolve(serverSecondTask)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await waitFor(() => {
      expect(projectRefetches.length).toBe(earlyProjectRefetchCount + 1)
      expect(allTaskRefetches.length).toBe(earlyAllTaskRefetchCount + 1)
    })
    await act(async () => {
      projectRefetches.at(-1)?.resolve([serverFirstTask, serverSecondTask])
      allTaskRefetches.at(-1)?.resolve([serverFirstTask, serverSecondTask])
      await secondMutation
    })

    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('atlas')))
      .toEqual([serverFirstTask, serverSecondTask])
    expect(queryClient.getQueryData(projectQueryKeys.allTasks))
      .toEqual([serverFirstTask, serverSecondTask])
  })

  it('rejects a conflicting task project before touching cache or server', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, projectId: 'borealis', version: 37 }
    const projectTasks = [task]
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('borealis'), projectTasks)
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const setQueryData = vi.spyOn(queryClient, 'setQueryData')
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const updateTaskProgress = vi.spyOn(repository, 'updateTaskProgress')
      .mockResolvedValue({ ...task, status: 'done', progress: 100 })
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

    await expect(result.current.mutateAsync({
      projectId: 'atlas',
      status: 'done',
      task,
    })).rejects.toThrow(
      `Task ${task.id} belongs to project borealis, not atlas`,
    )

    expect(cancelQueries).not.toHaveBeenCalled()
    expect(setQueryData).not.toHaveBeenCalled()
    expect(updateTaskProgress).not.toHaveBeenCalled()
    expect(invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('borealis')))
      .toBe(projectTasks)
  })

  it('uses the mutation project for legacy tasks without a project id', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, version: 39 }
    delete task.projectId
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('borealis'), [task])
    queryClient.setQueryData(projectQueryKeys.ganttFor('borealis'), [])
    queryClient.setQueryData(projectQueryKeys.ganttFor('atlas'), [])
    vi.spyOn(repository, 'updateTaskProgress').mockResolvedValue({
      ...task,
      status: 'done',
      progress: 100,
    })
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

    await act(() => result.current.mutateAsync({
      projectId: 'borealis',
      status: 'done',
      task,
    }))

    expect(queryClient.getQueryState(
      projectQueryKeys.ganttFor('borealis'),
    )?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(
      projectQueryKeys.ganttFor('atlas'),
    )?.isInvalidated).toBe(false)
  })

  it('invalidates canonical task-list arrays and pending filters only', async () => {
    const repository = createMockProjectRepository()
    const [fixtureTask] = await repository.listTasks('atlas')
    const task = { ...fixtureTask, projectId: 'atlas', version: 41 }
    const { queryClient, wrapper } = createDeleteHarness(repository, 'atlas')
    seedMoveInvalidationCaches(queryClient, 'atlas')
    queryClient.setQueryData(projectQueryKeys.tasksFor('atlas'), [task])
    const derivedArrayKey = ['tasks', 'atlas', { status: 'done' }] as const
    const pendingFilterKey = ['tasks', 'atlas', { assignee: 'agent-2' }] as const
    const metadataKey = ['tasks', 'atlas', 'metadata'] as const
    const pendingObjectMetadataKey = [
      'tasks',
      'atlas',
      { metadata: 'counts' },
    ] as const
    const arrayMetadataKey = ['tasks', 'atlas', 'metadata-array'] as const
    const stringMetadataKey = ['tasks', 'atlas', 'metadata-string'] as const
    const derivedTasks = [{ ...task, id: 'future-match-task' }]
    const metadata = { total: 1 }
    const arrayMetadata = [{ total: 1 }]
    const borealisTasks = [{
      ...task,
      projectId: 'borealis',
      status: 'not_started' as const,
      progress: 0,
    }]
    queryClient.setQueryData(derivedArrayKey, derivedTasks)
    queryClient.getQueryCache().build(queryClient, {
      queryKey: pendingFilterKey,
      queryFn: async () => [] as Task[],
    })
    queryClient.setQueryData(metadataKey, metadata)
    queryClient.getQueryCache().build(queryClient, {
      queryKey: pendingObjectMetadataKey,
      queryFn: async () => ({ total: 1 }),
    })
    queryClient.setQueryData(arrayMetadataKey, arrayMetadata)
    queryClient.setQueryData(stringMetadataKey, 'metadata')
    queryClient.setQueryData(
      projectQueryKeys.tasksFor('borealis'),
      borealisTasks,
    )
    const protectedKeys = [
      projectQueryKeys.projectMembersFor('atlas'),
      projectQueryKeys.sessionsFor('atlas'),
      projectQueryKeys.projectFor('borealis'),
      projectQueryKeys.dashboardFor('borealis', 7),
      ['gantt', 'atlas', 'detail'] as const,
      ['requirements', 'atlas', 'detail'] as const,
      ['activities', 'feed'] as const,
    ]
    for (const queryKey of protectedKeys) {
      queryClient.setQueryData(queryKey, { protected: true })
    }
    vi.spyOn(repository, 'updateTaskProgress').mockResolvedValue({
      ...task,
      status: 'done',
      progress: 100,
    })
    const { result } = renderHook(() => useMoveTaskStatus(), { wrapper })

    await act(() => result.current.mutateAsync({
      projectId: 'atlas',
      status: 'done',
      task,
    }))

    expectMoveCachesInvalidated(queryClient, 'atlas')
    expect(queryClient.getQueryState(derivedArrayKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(pendingFilterKey)?.isInvalidated).toBe(
      true,
    )
    expect(queryClient.getQueryData(metadataKey)).toBe(metadata)
    expect(queryClient.getQueryState(metadataKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(
      pendingObjectMetadataKey,
    )?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData(arrayMetadataKey)).toBe(arrayMetadata)
    expect(queryClient.getQueryState(arrayMetadataKey)?.isInvalidated).toBe(
      false,
    )
    expect(queryClient.getQueryState(stringMetadataKey)?.isInvalidated).toBe(
      false,
    )
    expect(queryClient.getQueryData(projectQueryKeys.tasksFor('borealis')))
      .toBe(borealisTasks)
    expect(queryClient.getQueryState(
      projectQueryKeys.tasksFor('borealis'),
    )?.isInvalidated).toBe(false)
    for (const queryKey of protectedKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false)
    }
  })
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
