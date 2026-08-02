import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryFilters,
} from '@tanstack/react-query'
import type { PersistedAppSettings } from '@project-os/contracts'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'

import type {
  CreateProjectInput,
  Project,
  RequirementStatus,
  Task,
  TaskDateInput,
  TaskProgressInput,
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

export {
  projectId,
  projectRepository,
  resetProjectRepositoryForTests,
}

type ProjectRepositoryContextValue = {
  repository: ProjectRepository
  projectId: string
  selectProject: (projectId: string) => void
}

export const workspaceProjectStorageKey = 'project-os:workspace-project'
const deletedProjectIdsByClient = new WeakMap<QueryClient, Set<string>>()

const ProjectRepositoryContext =
  createContext<ProjectRepositoryContextValue | null>(null)

export function ProjectRepositoryProvider({
  children,
  repository,
  projectId,
}: Omit<ProjectRepositoryContextValue, 'selectProject'> & {
  children: ReactNode
}) {
  const parent = useContext(ProjectRepositoryContext)
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  const selectProject = useCallback((nextProjectId: string) => {
    setSelectedProjectId(nextProjectId)
    try {
      sessionStorage.setItem(workspaceProjectStorageKey, nextProjectId)
    } catch {
      // Some browser privacy modes deny storage access; selection still works.
    }
  }, [])
  if (parent !== null) return children
  return createElement(
    ProjectRepositoryContext.Provider,
    {
      value: {
        repository,
        projectId: selectedProjectId,
        selectProject,
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
  }
}

export const projectQueryKeys = {
  actors: ['actors'] as const,
  currentActor: ['actors', 'current'] as const,
  activities: ['activities'] as const,
  allTasks: ['tasks', 'all'] as const,
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
  return (
    selectedProjectId !== ''
    && !deletedProjectIdsByClient.get(queryClient)?.has(selectedProjectId)
  )
}

function markProjectDeleted(
  queryClient: QueryClient,
  selectedProjectId: string,
) {
  const deletedProjectIds = deletedProjectIdsByClient.get(queryClient)
    ?? new Set<string>()
  deletedProjectIds.add(selectedProjectId)
  deletedProjectIdsByClient.set(queryClient, deletedProjectIds)
}

function clearDeletedProjects(queryClient: QueryClient) {
  deletedProjectIdsByClient.delete(queryClient)
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
    onSuccess: async () => {
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

      if (context.projectId === deletedProjectId) {
        const nextProjectId = remainingProjects?.find(
          ({ id }) => id === 'project_default',
        )?.id ?? remainingProjects?.[0]?.id ?? 'project_default'
        context.selectProject(nextProjectId)
      }

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
