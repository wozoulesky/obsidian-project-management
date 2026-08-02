import {
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryFilters,
  type QueryState,
} from '@tanstack/react-query'
import type { PersistedAppSettings } from '@project-os/contracts'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import type {
  CreateProjectInput,
  Project,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
  TaskStatus,
} from './domain'
import type {
  CreateHumanActorInput,
  CreateProjectTaskInput,
  AppearanceSettingsInput,
  ProjectRepository,
  UpdateActorInput,
} from './project-repository'
import {
  projectId,
  projectRepository,
  resetProjectRepositoryForTests,
} from '#repository-default'
import { progressForStatus } from './task-status'

export {
  projectId,
  projectRepository,
  resetProjectRepositoryForTests,
}

type ProjectRepositoryContextValue = {
  repository: ProjectRepository
  projectId: string
  selectProject: (projectId: string) => void
  selectProjectAfterDeletion: (
    deletedProjectId: string,
    nextProjectId: string,
  ) => void
}

export const workspaceProjectStorageKey = 'project-os:workspace-project'
type DeletedProjectRegistry = {
  ids: Set<string>
  listeners: Set<() => void>
}
const deletedProjectsByClient = new WeakMap<
  QueryClient,
  DeletedProjectRegistry
>()

const ProjectRepositoryContext =
  createContext<ProjectRepositoryContextValue | null>(null)

function persistWorkspaceProject(projectId: string) {
  try {
    if (projectId === '') {
      sessionStorage.removeItem(workspaceProjectStorageKey)
    } else {
      sessionStorage.setItem(workspaceProjectStorageKey, projectId)
    }
  } catch {
    // Some browser privacy modes deny storage access; selection still works.
  }
}

export function ProjectRepositoryProvider({
  children,
  repository,
  projectId,
}: Omit<
  ProjectRepositoryContextValue,
  'selectProject' | 'selectProjectAfterDeletion'
> & {
  children: ReactNode
}) {
  const parent = useContext(ProjectRepositoryContext)
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  const selectProject = useCallback((nextProjectId: string) => {
    setSelectedProjectId(nextProjectId)
    persistWorkspaceProject(nextProjectId)
  }, [])
  const selectProjectAfterDeletion = useCallback((
    deletedProjectId: string,
    nextProjectId: string,
  ) => {
    setSelectedProjectId((currentProjectId) => {
      if (currentProjectId !== deletedProjectId) return currentProjectId
      persistWorkspaceProject(nextProjectId)
      return nextProjectId
    })
  }, [])
  if (parent !== null) return children
  return createElement(
    ProjectRepositoryContext.Provider,
    {
      value: {
        repository,
        projectId: selectedProjectId,
        selectProject,
        selectProjectAfterDeletion,
      },
    },
    children,
  )
}

export function useProjectRepository() {
  return useContext(ProjectRepositoryContext) ?? {
    repository: projectRepository,
    projectId,
    selectProject: () => undefined,
    selectProjectAfterDeletion: () => undefined,
  }
}

export const projectQueryKeys = {
  actors: ['actors'] as const,
  currentActor: ['actors', 'current'] as const,
  activities: ['activities'] as const,
  allTasks: ['tasks', { scope: 'all' }] as const,
  projects: ['projects'] as const,
  projectFor: (selectedProjectId: string) =>
    ['projects', selectedProjectId] as const,
  projectMembersFor: (selectedProjectId: string) =>
    ['projects', selectedProjectId, 'members'] as const,
  settings: ['settings'] as const,
  health: ['health'] as const,
  tokens: ['tokens'] as const,
  dashboardPrefixFor: (selectedProjectId: string) =>
    ['dashboard', selectedProjectId] as const,
  dashboardFor: (selectedProjectId: string, days: 7 | 30 | 90) =>
    ['dashboard', selectedProjectId, days] as const,
  workspaceDashboardPrefix: [
    'dashboard',
    { scope: 'workspace' },
  ] as const,
  workspaceDashboardFor: (days: 7 | 30 | 90) =>
    ['dashboard', { scope: 'workspace' }, days] as const,
  tasksFor: (selectedProjectId: string) =>
    ['tasks', selectedProjectId] as const,
  requirementsFor: (selectedProjectId: string) =>
    ['requirements', selectedProjectId] as const,
  defectsFor: (selectedProjectId: string) =>
    ['defects', selectedProjectId] as const,
  ganttFor: (selectedProjectId: string) =>
    ['gantt', selectedProjectId] as const,
  sessionsFor: (selectedProjectId: string) =>
    ['projects', selectedProjectId, 'sessions'] as const,
  handoffsFor: (selectedProjectId: string) =>
    ['projects', selectedProjectId, 'handoffs'] as const,
  deliverablesFor: (selectedProjectId: string) =>
    ['projects', selectedProjectId, 'deliverables'] as const,
  dashboardPrefix: ['dashboard', projectId] as const,
  dashboard: (days: 7 | 30 | 90) =>
    ['dashboard', projectId, days] as const,
  tasks: ['tasks', projectId] as const,
  requirements: ['requirements', projectId] as const,
  defects: ['defects', projectId] as const,
  gantt: ['gantt', projectId] as const,
}

function useProjectQueryEnabled(selectedProjectId: string): boolean {
  const queryClient = useQueryClient()
  const subscribe = useCallback((listener: () => void) => {
    const registry = getDeletedProjectRegistry(queryClient)
    registry.listeners.add(listener)
    return () => {
      registry.listeners.delete(listener)
    }
  }, [queryClient])
  const getSnapshot = useCallback(
    () => deletedProjectsByClient
      .get(queryClient)
      ?.ids.has(selectedProjectId) ?? false,
    [queryClient, selectedProjectId],
  )
  const isDeleted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  )
  return (
    selectedProjectId !== ''
    && !isDeleted
  )
}

function getDeletedProjectRegistry(
  queryClient: QueryClient,
): DeletedProjectRegistry {
  const current = deletedProjectsByClient.get(queryClient)
  if (current !== undefined) return current
  const created: DeletedProjectRegistry = {
    ids: new Set(),
    listeners: new Set(),
  }
  deletedProjectsByClient.set(queryClient, created)
  return created
}

function notifyDeletedProjectListeners(registry: DeletedProjectRegistry) {
  for (const listener of registry.listeners) listener()
}

function markProjectDeleted(
  queryClient: QueryClient,
  selectedProjectId: string,
) {
  const registry = getDeletedProjectRegistry(queryClient)
  if (!registry.ids.has(selectedProjectId)) {
    registry.ids.add(selectedProjectId)
    notifyDeletedProjectListeners(registry)
  }
}

function clearDeletedProjects(queryClient: QueryClient) {
  const registry = deletedProjectsByClient.get(queryClient)
  if (registry === undefined || registry.ids.size === 0) return
  registry.ids.clear()
  notifyDeletedProjectListeners(registry)
}

function clearDeletedProject(
  queryClient: QueryClient,
  selectedProjectId: string,
) {
  const registry = deletedProjectsByClient.get(queryClient)
  if (registry?.ids.delete(selectedProjectId)) {
    notifyDeletedProjectListeners(registry)
  }
}

export function projectOwnedQueryKeys(
  selectedProjectId: string,
): readonly QueryFilters[] {
  return [
    {
      queryKey: projectQueryKeys.projectFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.projectMembersFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.tasksFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.requirementsFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.defectsFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.ganttFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.dashboardPrefixFor(selectedProjectId),
      exact: false,
    },
    {
      queryKey: projectQueryKeys.sessionsFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.handoffsFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.deliverablesFor(selectedProjectId),
      exact: true,
    },
  ] as const
}

const createTaskQueryOptions = (
  repository: ProjectRepository,
  selectedProjectId: string,
  enabled: boolean,
) =>
  import.meta.env.DEV
  || (
    import.meta.env.MODE === 'e2e'
    && import.meta.env.VITE_E2E_FIXTURES === 'true'
  )
    ? () => {
        let shouldFail = false

        try {
          shouldFail =
            typeof sessionStorage !== 'undefined' &&
            sessionStorage.getItem('project-os:e2e-fixture') === 'tasks-error'
        } catch {
          // Some browser privacy modes deny storage access; keep the safe default.
        }

        return {
          queryKey: projectQueryKeys.tasksFor(selectedProjectId),
          enabled,
          queryFn: shouldFail
            ? () => {
                throw new Error('任务数据加载失败，请重试。')
              }
            : () => repository.listTasks(selectedProjectId),
          ...(shouldFail ? { retry: false as const } : {}),
        }
      }
    : () => ({
        queryKey: projectQueryKeys.tasksFor(selectedProjectId),
        enabled,
        queryFn: () => repository.listTasks(selectedProjectId),
      })

export const mutationInvalidationKeys = {
  projectCreate: [
    projectQueryKeys.projects,
    projectQueryKeys.actors,
    ['dashboard'],
    projectQueryKeys.activities,
  ],
  taskProgress: [
    projectQueryKeys.tasks,
    projectQueryKeys.allTasks,
    projectQueryKeys.gantt,
    projectQueryKeys.requirements,
    projectQueryKeys.dashboardPrefix,
    projectQueryKeys.workspaceDashboardPrefix,
  ],
  actorMutation: [
    projectQueryKeys.actors,
    projectQueryKeys.projects,
    ['tasks'],
    ['dashboard'],
    projectQueryKeys.activities,
  ],
  taskDates: [
    projectQueryKeys.tasks,
    projectQueryKeys.allTasks,
    projectQueryKeys.gantt,
    projectQueryKeys.dashboardPrefix,
    projectQueryKeys.workspaceDashboardPrefix,
  ],
  requirementStatus: [
    projectQueryKeys.requirements,
    projectQueryKeys.dashboardPrefix,
    projectQueryKeys.workspaceDashboardPrefix,
  ],
  defectConversion: [
    projectQueryKeys.tasks,
    projectQueryKeys.allTasks,
    projectQueryKeys.gantt,
    projectQueryKeys.defects,
    projectQueryKeys.dashboardPrefix,
    projectQueryKeys.workspaceDashboardPrefix,
  ],
} as const

function invalidateKeys(
  queryClient: QueryClient,
  queryKeys: readonly (readonly unknown[])[],
) {
  return Promise.all(
    queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )
}

export function useDashboard(days: 7 | 30 | 90 = 30) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(context.projectId)
  return useQuery({
    queryKey: projectQueryKeys.dashboardFor(context.projectId, days),
    queryFn: () => context.repository.getDashboard(context.projectId, days),
    enabled,
  })
}

export function useProjects() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.projects,
    queryFn: () => context.repository.listProjects(),
  })
}

export function useProject(selectedProjectId: string) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(selectedProjectId)
  return useQuery({
    queryKey: projectQueryKeys.projectFor(selectedProjectId),
    queryFn: () => context.repository.getProject(selectedProjectId),
    enabled,
  })
}

export function useProjectMembers(selectedProjectId: string) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(selectedProjectId)
  return useQuery({
    queryKey: projectQueryKeys.projectMembersFor(selectedProjectId),
    queryFn: () => context.repository.listProjectMembers(selectedProjectId),
    enabled,
  })
}

export function useProjectSessions(selectedProjectId: string) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(selectedProjectId)
  return useQuery({
    queryKey: projectQueryKeys.sessionsFor(selectedProjectId),
    queryFn: () => context.repository.listProjectSessions(selectedProjectId),
    enabled,
  })
}

export function useProjectHandoffs(selectedProjectId: string) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(selectedProjectId)
  return useQuery({
    queryKey: projectQueryKeys.handoffsFor(selectedProjectId),
    queryFn: () => context.repository.listProjectHandoffs(selectedProjectId),
    enabled,
  })
}

export function useProjectDeliverables(selectedProjectId: string) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(selectedProjectId)
  return useQuery({
    queryKey: projectQueryKeys.deliverablesFor(selectedProjectId),
    queryFn: () =>
      context.repository.listProjectDeliverables(selectedProjectId),
    enabled,
  })
}

export function useActors() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.actors,
    queryFn: () => context.repository.listActors(),
  })
}

export function useWorkspaceDashboard(days: 7 | 30 | 90 = 30) {
  const { repository } = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.workspaceDashboardFor(days),
    queryFn: () => repository.getWorkspaceDashboard(days),
  })
}

export function useCurrentActor() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.currentActor,
    queryFn: () => context.repository.getCurrentActor(),
  })
}

const actorInvalidationKeys = [
  projectQueryKeys.actors,
  projectQueryKeys.projects,
  ['tasks'],
  ['dashboard'],
  projectQueryKeys.activities,
] as const

export function useCreateHuman() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: (input: CreateHumanActorInput) =>
      context.repository.createHuman(input),
    onSuccess: async () => {
      await invalidateKeys(queryClient, actorInvalidationKeys)
    },
  })
}

export function useUpdateActor() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({
      actorId,
      input,
    }: {
      actorId: string
      input: UpdateActorInput
    }) => context.repository.updateActor(actorId, input),
    onSuccess: async () => {
      await invalidateKeys(queryClient, actorInvalidationKeys)
    },
  })
}

export function useDeactivateActor() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({
      actorId,
      version,
    }: {
      actorId: string
      version: number
    }) => context.repository.deactivateActor(actorId, version),
    onSuccess: async () => {
      await invalidateKeys(queryClient, actorInvalidationKeys)
    },
  })
}

export function useAllTasks() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.allTasks,
    queryFn: () => context.repository.listAllTasks(),
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      context.repository.createProject(input),
    onSuccess: async (createdProject) => {
      clearDeletedProject(queryClient, createdProject.id)
      await invalidateKeys(queryClient, [
        projectQueryKeys.projects,
        projectQueryKeys.actors,
        ['dashboard'],
        projectQueryKeys.activities,
      ])
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({ projectId: selectedProjectId, version }: {
      projectId: string
      version: number
    }) => context.repository.deleteProject(selectedProjectId, version),
    onSuccess: async (_, { projectId: deletedProjectId }) => {
      const cachedProjects = queryClient.getQueryData<Project[]>(
        projectQueryKeys.projects,
      )
      const remainingProjects = cachedProjects?.filter(
        ({ id }) => id !== deletedProjectId,
      )
      if (remainingProjects !== undefined) {
        queryClient.setQueryData(projectQueryKeys.projects, remainingProjects)
      }

      const cachedTasks = queryClient.getQueryData<Task[]>(
        projectQueryKeys.allTasks,
      )
      if (cachedTasks !== undefined) {
        queryClient.setQueryData(
          projectQueryKeys.allTasks,
          cachedTasks.filter(({ projectId }) => projectId !== deletedProjectId),
        )
      }

      markProjectDeleted(queryClient, deletedProjectId)

      for (const filters of projectOwnedQueryKeys(deletedProjectId)) {
        queryClient.removeQueries(filters)
      }

      const nextProjectId = remainingProjects?.find(
        ({ id }) => id === 'project_default',
      )?.id ?? remainingProjects?.[0]?.id ?? ''
      context.selectProjectAfterDeletion(deletedProjectId, nextProjectId)

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.projects,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.allTasks,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.workspaceDashboardPrefix,
        }),
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.activities,
        }),
      ])
    },
  })
}

export function useCreateTask(selectedProjectId: string) {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: (input: CreateProjectTaskInput) =>
      context.repository.createTask(selectedProjectId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.projectFor(selectedProjectId),
        }),
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.projects,
          exact: true,
        }),
        ...[
          projectQueryKeys.tasksFor(selectedProjectId),
          projectQueryKeys.allTasks,
          projectQueryKeys.ganttFor(selectedProjectId),
          ['dashboard'] as const,
          projectQueryKeys.activities,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ])
    },
  })
}

export function useProjectTasks(selectedProjectId: string) {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(selectedProjectId)
  return useQuery(
    createTaskQueryOptions(context.repository, selectedProjectId, enabled)(),
  )
}

export function useTasks() {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(context.projectId)
  return useQuery(
    createTaskQueryOptions(context.repository, context.projectId, enabled)(),
  )
}

export function useUpdateTaskProgress() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string
      input: TaskProgressInput
      projectId?: string
    }) => context.repository.updateTaskProgress(taskId, input),
    onSuccess: async (_, variables) => {
      const selectedProjectId = variables.projectId ?? context.projectId
      await invalidateKeys(
        queryClient,
        [
          projectQueryKeys.tasksFor(selectedProjectId),
          projectQueryKeys.allTasks,
          projectQueryKeys.ganttFor(selectedProjectId),
          projectQueryKeys.requirementsFor(selectedProjectId),
          projectQueryKeys.dashboardPrefixFor(selectedProjectId),
          projectQueryKeys.workspaceDashboardPrefix,
          projectQueryKeys.projectFor(selectedProjectId),
          projectQueryKeys.projects,
          projectQueryKeys.activities,
        ],
      )
    },
  })
}

type MoveTaskStatusVariables = {
  projectId: string
  status: TaskStatus
  task: Task
}

type TaskMoveSnapshot = {
  query: Query
  originalState: QueryState
  originalItem: Task
  optimisticData: unknown
  optimisticDataUpdateCount: number
  optimisticError: unknown
  optimisticEpoch: number
  optimisticItem: Task
  optimisticIsInvalidated: boolean
  optimisticStatus: QueryState['status']
}

type TaskMoveQueryMarker = {
  dataUpdateCount: number
  epoch: number
}

type PendingTaskMoveScopes = {
  projects: Map<string, number>
  total: number
}

const pendingTaskMovesByClient = new WeakMap<
  QueryClient,
  Map<string, symbol>
>()
const pendingTaskMoveScopesByClient = new WeakMap<
  QueryClient,
  PendingTaskMoveScopes
>()
const taskMoveQueryMarkers = new WeakMap<Query, TaskMoveQueryMarker>()

const approvedTaskListFilterKeys = new Set([
  'assignee',
  'assigneeId',
  'milestoneId',
  'priority',
  'q',
  'query',
  'search',
  'status',
  'statuses',
])

function isApprovedTaskListQueryKey(
  queryKey: readonly unknown[],
  selectedProjectId: string,
) {
  if (queryKey[0] !== 'tasks' || queryKey[1] !== selectedProjectId) {
    return false
  }
  if (queryKey.length === 2) return true
  if (queryKey.length !== 3) return false
  const filter = queryKey[2]
  if (
    filter === null
    || typeof filter !== 'object'
    || Array.isArray(filter)
  ) return false
  const keys = Object.keys(filter)
  return keys.length > 0 && keys.every(
    (key) => approvedTaskListFilterKeys.has(key),
  )
}

function syncTaskMoveQueryEpoch(query: Query) {
  const currentCount = query.state.dataUpdateCount
  const marker = taskMoveQueryMarkers.get(query)
  if (marker === undefined) {
    const created = { dataUpdateCount: currentCount, epoch: 0 }
    taskMoveQueryMarkers.set(query, created)
    return created.epoch
  }
  if (marker.dataUpdateCount !== currentCount) {
    marker.dataUpdateCount = currentCount
    marker.epoch += 1
  }
  return marker.epoch
}

function recordTaskMoveQueryUpdate(query: Query) {
  const marker = taskMoveQueryMarkers.get(query)
  if (marker === undefined) {
    taskMoveQueryMarkers.set(query, {
      dataUpdateCount: query.state.dataUpdateCount,
      epoch: 0,
    })
    return 0
  }
  marker.dataUpdateCount = query.state.dataUpdateCount
  return marker.epoch
}

function getPendingTaskMoves(queryClient: QueryClient) {
  const current = pendingTaskMovesByClient.get(queryClient)
  if (current !== undefined) return current
  const created = new Map<string, symbol>()
  pendingTaskMovesByClient.set(queryClient, created)
  return created
}

function registerTaskMoveScope(
  queryClient: QueryClient,
  projectId: string,
) {
  const current = pendingTaskMoveScopesByClient.get(queryClient) ?? {
    projects: new Map<string, number>(),
    total: 0,
  }
  current.total += 1
  current.projects.set(projectId, (current.projects.get(projectId) ?? 0) + 1)
  pendingTaskMoveScopesByClient.set(queryClient, current)
}

function releaseTaskMoveScope(
  queryClient: QueryClient,
  projectId: string,
) {
  const current = pendingTaskMoveScopesByClient.get(queryClient)
  if (current === undefined) {
    return { allTasks: false, projectTaskLists: false }
  }
  current.total = Math.max(0, current.total - 1)
  const projectCount = current.projects.get(projectId) ?? 0
  if (projectCount <= 1) current.projects.delete(projectId)
  else current.projects.set(projectId, projectCount - 1)
  if (current.total === 0) pendingTaskMoveScopesByClient.delete(queryClient)
  return {
    allTasks: current.total === 0,
    projectTaskLists: !current.projects.has(projectId),
  }
}

function releaseTaskMove(
  queryClient: QueryClient,
  taskId: string,
  token: symbol,
) {
  const pendingMoves = pendingTaskMovesByClient.get(queryClient)
  if (pendingMoves?.get(taskId) === token) pendingMoves.delete(taskId)
}

function rollbackTaskMoveSnapshots(snapshots: readonly TaskMoveSnapshot[]) {
  for (const snapshot of snapshots) {
    if (syncTaskMoveQueryEpoch(snapshot.query) !== snapshot.optimisticEpoch) {
      continue
    }
    const currentState = snapshot.query.state
    if (!Array.isArray(currentState.data)) continue
    const currentTasks = currentState.data as Task[]
    const currentItem = currentTasks.find(
      (candidate) => candidate.id === snapshot.originalItem.id,
    )
    if (currentItem !== snapshot.optimisticItem) continue

    if (
      currentState.data !== snapshot.optimisticData
      || currentState.dataUpdateCount !== snapshot.optimisticDataUpdateCount
    ) {
      snapshot.query.setState({
        data: currentTasks.map((candidate) => (
          candidate === snapshot.optimisticItem
            ? snapshot.originalItem
            : candidate
        )),
      })
      recordTaskMoveQueryUpdate(snapshot.query)
      continue
    }

    const rollbackState: Partial<QueryState> = {
      data: snapshot.originalState.data,
      dataUpdateCount: snapshot.originalState.dataUpdateCount,
      dataUpdatedAt: snapshot.originalState.dataUpdatedAt,
    }
    if (currentState.error === snapshot.optimisticError) {
      rollbackState.error = snapshot.originalState.error
    }
    if (currentState.isInvalidated === snapshot.optimisticIsInvalidated) {
      rollbackState.isInvalidated = snapshot.originalState.isInvalidated
    }
    if (currentState.status === snapshot.optimisticStatus) {
      rollbackState.status = snapshot.originalState.status
    }
    snapshot.query.setState(rollbackState)
    recordTaskMoveQueryUpdate(snapshot.query)
  }
}

function mergeTaskMoveServerResult(
  snapshots: readonly TaskMoveSnapshot[],
  serverTask: Task,
) {
  for (const snapshot of snapshots) {
    if (syncTaskMoveQueryEpoch(snapshot.query) !== snapshot.optimisticEpoch) {
      continue
    }
    const currentData = snapshot.query.state.data
    if (!Array.isArray(currentData)) continue
    const currentTasks = currentData as Task[]
    if (!currentTasks.some(
      (candidate) => candidate === snapshot.optimisticItem,
    )) continue
    snapshot.query.setState({
      data: currentTasks.map((candidate) => (
        candidate === snapshot.optimisticItem ? serverTask : candidate
      )),
    })
    recordTaskMoveQueryUpdate(snapshot.query)
  }
}

function taskMoveQueryCandidates(
  queryClient: QueryClient,
  selectedProjectId: string,
  taskId: string,
) {
  const queryCache = queryClient.getQueryCache()
  const projectTaskQueries = queryCache.findAll({
    queryKey: projectQueryKeys.tasksFor(selectedProjectId),
  }).filter(({ queryKey }) => (
    isApprovedTaskListQueryKey(queryKey, selectedProjectId)
  ))
  const allTasksQuery = queryCache.find({
    queryKey: projectQueryKeys.allTasks,
    exact: true,
  })
  return [
    ...projectTaskQueries,
    ...(allTasksQuery === undefined ? [] : [allTasksQuery]),
  ].filter(({ state }) => (
    Array.isArray(state.data)
    && (state.data as Task[]).some((candidate) => candidate.id === taskId)
  ))
}

function invalidateTaskMoveQueries(
  queryClient: QueryClient,
  selectedProjectId: string,
  options: {
    projectTaskLists: boolean
    allTasks: boolean
  },
) {
  const taskListFilters: QueryFilters[] = options.projectTaskLists
    ? queryClient.getQueryCache()
      .findAll({ queryKey: projectQueryKeys.tasksFor(selectedProjectId) })
      .filter(({ queryKey }) => (
        isApprovedTaskListQueryKey(queryKey, selectedProjectId)
      ))
      .map(({ queryKey }) => ({ queryKey, exact: true }))
    : []
  const filters: readonly QueryFilters[] = [
    ...taskListFilters,
    ...(options.allTasks
      ? [{ queryKey: projectQueryKeys.allTasks, exact: true }]
      : []),
    { queryKey: projectQueryKeys.ganttFor(selectedProjectId), exact: true },
    {
      queryKey: projectQueryKeys.requirementsFor(selectedProjectId),
      exact: true,
    },
    {
      queryKey: projectQueryKeys.dashboardPrefixFor(selectedProjectId),
      exact: false,
    },
    {
      queryKey: projectQueryKeys.workspaceDashboardPrefix,
      exact: false,
    },
    { queryKey: projectQueryKeys.projectFor(selectedProjectId), exact: true },
    { queryKey: projectQueryKeys.projects, exact: true },
    { queryKey: projectQueryKeys.activities, exact: true },
  ]
  return Promise.all(filters.map((filter) => (
    queryClient.invalidateQueries(filter)
  )))
}

export function useMoveTaskStatus() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({ status, task }: MoveTaskStatusVariables) =>
      context.repository.updateTaskProgress(task.id, {
        progress: progressForStatus(status, task.progress),
        status,
        note: `Moved to ${status} from task board`,
        version: task.version,
      }),
    onMutate: async ({
      projectId: variableProjectId,
      status,
      task,
    }: MoveTaskStatusVariables) => {
      if (
        task.projectId !== undefined
        && task.projectId !== variableProjectId
      ) {
        throw new Error(
          `Task ${task.id} belongs to project ${task.projectId}, not ${variableProjectId}`,
        )
      }
      const canonicalProjectId = task.projectId ?? variableProjectId
      const pendingMoves = getPendingTaskMoves(queryClient)
      if (pendingMoves.has(task.id)) {
        throw new Error(`Task ${task.id} already has a pending status move`)
      }
      const token = Symbol(task.id)
      pendingMoves.set(task.id, token)
      registerTaskMoveScope(queryClient, canonicalProjectId)
      let snapshots: TaskMoveSnapshot[] = []

      try {
        const candidates = taskMoveQueryCandidates(
          queryClient,
          canonicalProjectId,
          task.id,
        )
        await Promise.all(candidates.map(({ queryKey }) => (
          queryClient.cancelQueries({ queryKey, exact: true })
        )))
        snapshots = candidates
          .filter(({ state }) => (
            Array.isArray(state.data)
            && (state.data as Task[]).some(
              (candidate) => candidate.id === task.id,
            )
          ))
          .map((query) => ({
            query,
            originalState: query.state,
            originalItem: (query.state.data as Task[]).find(
              (candidate) => candidate.id === task.id,
            )!,
            optimisticData: undefined,
            optimisticDataUpdateCount: -1,
            optimisticError: undefined,
            optimisticEpoch: -1,
            optimisticItem: task,
            optimisticIsInvalidated: false,
            optimisticStatus: 'pending',
          }))

        for (const snapshot of snapshots) {
          if (!Array.isArray(snapshot.originalState.data)) continue
          const cachedTasks = snapshot.originalState.data as Task[]
          let foundTask = false
          const optimisticTasks = cachedTasks.map((candidate) => {
            if (candidate.id !== task.id) return candidate
            foundTask = true
            return {
              ...candidate,
              status,
              progress: progressForStatus(status, candidate.progress),
            }
          })
          if (!foundTask) continue
          syncTaskMoveQueryEpoch(snapshot.query)
          queryClient.setQueryData(snapshot.query.queryKey, optimisticTasks)
          const optimisticState = snapshot.query.state
          snapshot.optimisticData = optimisticState.data
          snapshot.optimisticDataUpdateCount = optimisticState.dataUpdateCount
          snapshot.optimisticError = optimisticState.error
          snapshot.optimisticEpoch = recordTaskMoveQueryUpdate(snapshot.query)
          snapshot.optimisticItem = (optimisticState.data as Task[]).find(
            (candidate) => candidate.id === task.id,
          )!
          snapshot.optimisticIsInvalidated = optimisticState.isInvalidated
          snapshot.optimisticStatus = optimisticState.status
        }

        return {
          canonicalProjectId,
          snapshots,
          taskId: task.id,
          token,
        }
      } catch (error) {
        try {
          rollbackTaskMoveSnapshots(snapshots)
        } finally {
          snapshots.length = 0
          releaseTaskMove(queryClient, task.id, token)
          releaseTaskMoveScope(queryClient, canonicalProjectId)
        }
        throw error
      }
    },
    onError: (_error, _variables, mutationContext) => {
      if (mutationContext === undefined) return
      const pendingMoves = pendingTaskMovesByClient.get(queryClient)
      if (pendingMoves?.get(mutationContext.taskId) !== mutationContext.token) {
        mutationContext.snapshots.length = 0
        return
      }
      rollbackTaskMoveSnapshots(mutationContext.snapshots)
    },
    onSuccess: (serverTask, _variables, mutationContext) => {
      if (mutationContext === undefined) return
      const pendingMoves = pendingTaskMovesByClient.get(queryClient)
      if (pendingMoves?.get(mutationContext.taskId) !== mutationContext.token) {
        return
      }
      mergeTaskMoveServerResult(
        mutationContext.snapshots,
        serverTask,
      )
    },
    onSettled: async (_data, _error, _variables, mutationContext) => {
      if (mutationContext === undefined) return
      const pendingMoves = pendingTaskMovesByClient.get(queryClient)
      if (pendingMoves?.get(mutationContext.taskId) !== mutationContext.token) {
        return
      }
      const invalidationOptions = releaseTaskMoveScope(
        queryClient,
        mutationContext.canonicalProjectId,
      )
      try {
        await invalidateTaskMoveQueries(
          queryClient,
          mutationContext.canonicalProjectId,
          invalidationOptions,
        )
      } finally {
        mutationContext.snapshots.length = 0
        releaseTaskMove(
          queryClient,
          mutationContext.taskId,
          mutationContext.token,
        )
      }
    },
  })
}

export function useUpdateTaskDates() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string
      input: TaskDateInput
    }) => context.repository.updateTaskDates(taskId, input),
    onSuccess: async () => {
      await invalidateKeys(queryClient, [
        projectQueryKeys.tasksFor(context.projectId),
        projectQueryKeys.allTasks,
        projectQueryKeys.ganttFor(context.projectId),
        projectQueryKeys.dashboardPrefixFor(context.projectId),
        projectQueryKeys.workspaceDashboardPrefix,
      ])
    },
  })
}

export function useRequirements() {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(context.projectId)
  return useQuery({
    queryKey: projectQueryKeys.requirementsFor(context.projectId),
    queryFn: () => context.repository.listRequirements(context.projectId),
    enabled,
  })
}

export function useUpdateRequirementStatus() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: ({
      requirementId,
      status,
    }: {
      requirementId: string
      status: RequirementStatus
    }) => context.repository.updateRequirementStatus(requirementId, status),
    onSuccess: async () => {
      await invalidateKeys(
        queryClient,
        [
          projectQueryKeys.requirementsFor(context.projectId),
          projectQueryKeys.dashboardPrefixFor(context.projectId),
          projectQueryKeys.workspaceDashboardPrefix,
        ],
      )
    },
  })
}

export function useDefects() {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(context.projectId)
  return useQuery({
    queryKey: projectQueryKeys.defectsFor(context.projectId),
    queryFn: () => context.repository.listDefects(context.projectId),
    enabled,
  })
}

export function useCreateTaskFromDefect() {
  const queryClient = useQueryClient()
  const context = useProjectRepository()
  return useMutation({
    mutationFn: (defectId: string) =>
      context.repository.createTaskFromDefect(defectId),
    onSuccess: async () => {
      await invalidateKeys(
        queryClient,
        [
          projectQueryKeys.tasksFor(context.projectId),
          projectQueryKeys.allTasks,
          projectQueryKeys.ganttFor(context.projectId),
          projectQueryKeys.defectsFor(context.projectId),
          projectQueryKeys.dashboardPrefixFor(context.projectId),
          projectQueryKeys.workspaceDashboardPrefix,
        ],
      )
    },
  })
}

export function useGanttTasks() {
  const context = useProjectRepository()
  const enabled = useProjectQueryEnabled(context.projectId)
  return useQuery({
    queryKey: projectQueryKeys.ganttFor(context.projectId),
    queryFn: () => context.repository.listGanttTasks(context.projectId),
    enabled,
  })
}

export function useSettings() {
  const { repository } = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.settings,
    queryFn: () => repository.getSettings(),
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  const { repository } = useProjectRepository()
  return useMutation({
    mutationFn: (input: AppearanceSettingsInput) =>
      repository.updateSettings(input),
    onSuccess: async (settings) => {
      queryClient.setQueryData<PersistedAppSettings>(
        projectQueryKeys.settings,
        (cached) =>
          cached === undefined || settings.version >= cached.version
            ? settings
            : cached,
      )
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.activities,
      })
    },
  })
}

export function useHealth() {
  const { repository } = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.health,
    queryFn: () => repository.getHealth(),
    refetchInterval: 30_000,
  })
}

export function useTokens() {
  const { repository } = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.tokens,
    queryFn: () => repository.listTokens(),
  })
}

export function useIssueToken() {
  const queryClient = useQueryClient()
  const { repository } = useProjectRepository()
  return useMutation({
    mutationFn: (name: string) => repository.issueToken(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.tokens,
      })
    },
  })
}

export function useRevokeToken() {
  const queryClient = useQueryClient()
  const { repository } = useProjectRepository()
  return useMutation({
    mutationFn: ({ tokenId, version }: {
      tokenId: string
      version: number
    }) => repository.revokeToken(tokenId, version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.tokens,
      })
    },
  })
}

export function useCreateBackup() {
  const { repository } = useProjectRepository()
  return useMutation({
    mutationFn: (filename?: string) => repository.createBackup(filename),
  })
}

export function useRestoreBackup() {
  const queryClient = useQueryClient()
  const { repository } = useProjectRepository()
  return useMutation({
    mutationFn: (filename: string) => repository.restoreBackup(filename),
    onSuccess: async () => {
      clearDeletedProjects(queryClient)
      await queryClient.invalidateQueries()
    },
  })
}

export function useImportData() {
  const queryClient = useQueryClient()
  const { repository } = useProjectRepository()
  return useMutation({
    mutationFn: (file: File) => repository.importData(file),
    onSuccess: async () => {
      clearDeletedProjects(queryClient)
      await queryClient.invalidateQueries()
    },
  })
}
