import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from 'react'

import type {
  CreateProjectInput,
  RequirementStatus,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import { createMockProjectRepository } from './mock-project-repository'
import type {
  CreateHumanActorInput,
  CreateProjectTaskInput,
  AppearanceSettingsInput,
  ProjectRepository,
  UpdateActorInput,
} from './project-repository'

export const projectRepository = createMockProjectRepository()
export const projectId = 'atlas'

type ProjectRepositoryContextValue = {
  repository: ProjectRepository
  projectId: string
}

const ProjectRepositoryContext =
  createContext<ProjectRepositoryContextValue | null>(null)

export function ProjectRepositoryProvider({
  children,
  repository,
  projectId,
}: ProjectRepositoryContextValue & { children: ReactNode }) {
  const parent = useContext(ProjectRepositoryContext)
  if (parent !== null) return children
  return createElement(
    ProjectRepositoryContext.Provider,
    { value: { repository, projectId } },
    children,
  )
}

export function useProjectRepository() {
  return useContext(ProjectRepositoryContext) ?? {
    repository: projectRepository,
    projectId,
  }
}

export function resetProjectRepositoryForTests() {
  Object.assign(projectRepository, createMockProjectRepository())
}

export const projectQueryKeys = {
  actors: ['actors'] as const,
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
  tasksFor: (selectedProjectId: string) =>
    ['tasks', selectedProjectId] as const,
  requirementsFor: (selectedProjectId: string) =>
    ['requirements', selectedProjectId] as const,
  defectsFor: (selectedProjectId: string) =>
    ['defects', selectedProjectId] as const,
  ganttFor: (selectedProjectId: string) =>
    ['gantt', selectedProjectId] as const,
  dashboardPrefix: ['dashboard', projectId] as const,
  dashboard: (days: 7 | 30 | 90) =>
    ['dashboard', projectId, days] as const,
  tasks: ['tasks', projectId] as const,
  requirements: ['requirements', projectId] as const,
  defects: ['defects', projectId] as const,
  gantt: ['gantt', projectId] as const,
}

const createTaskQueryOptions = (
  repository: ProjectRepository,
  selectedProjectId: string,
) =>
  import.meta.env.DEV || import.meta.env.VITE_E2E_FIXTURES === 'true'
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
  ],
  requirementStatus: [
    projectQueryKeys.requirements,
    projectQueryKeys.dashboardPrefix,
  ],
  defectConversion: [
    projectQueryKeys.tasks,
    projectQueryKeys.allTasks,
    projectQueryKeys.gantt,
    projectQueryKeys.defects,
    projectQueryKeys.dashboardPrefix,
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
  return useQuery({
    queryKey: projectQueryKeys.dashboardFor(context.projectId, days),
    queryFn: () => context.repository.getDashboard(context.projectId, days),
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
  return useQuery({
    queryKey: projectQueryKeys.projectFor(selectedProjectId),
    queryFn: () => context.repository.getProject(selectedProjectId),
    enabled: selectedProjectId !== '',
  })
}

export function useProjectMembers(selectedProjectId: string) {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.projectMembersFor(selectedProjectId),
    queryFn: () => context.repository.listProjectMembers(selectedProjectId),
    enabled: selectedProjectId !== '',
  })
}

export function useActors() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.actors,
    queryFn: () => context.repository.listActors(),
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
  return useQuery(
    createTaskQueryOptions(context.repository, selectedProjectId)(),
  )
}

export function useTasks() {
  const context = useProjectRepository()
  return useQuery(
    createTaskQueryOptions(context.repository, context.projectId)(),
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
      ])
    },
  })
}

export function useRequirements() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.requirementsFor(context.projectId),
    queryFn: () => context.repository.listRequirements(context.projectId),
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
        ],
      )
    },
  })
}

export function useDefects() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.defectsFor(context.projectId),
    queryFn: () => context.repository.listDefects(context.projectId),
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
        ],
      )
    },
  })
}

export function useGanttTasks() {
  const context = useProjectRepository()
  return useQuery({
    queryKey: projectQueryKeys.ganttFor(context.projectId),
    queryFn: () => context.repository.listGanttTasks(context.projectId),
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
      queryClient.setQueryData(projectQueryKeys.settings, settings)
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
      await queryClient.invalidateQueries()
    },
  })
}
