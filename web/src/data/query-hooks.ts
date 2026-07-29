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
  RequirementStatus,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import { createMockProjectRepository } from './mock-project-repository'
import type { ProjectRepository } from './project-repository'

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
  projects: ['projects'] as const,
  settings: ['settings'] as const,
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
  taskProgress: [
    projectQueryKeys.tasks,
    projectQueryKeys.gantt,
    projectQueryKeys.requirements,
    projectQueryKeys.dashboardPrefix,
  ],
  taskDates: [
    projectQueryKeys.tasks,
    projectQueryKeys.gantt,
    projectQueryKeys.dashboardPrefix,
  ],
  requirementStatus: [
    projectQueryKeys.requirements,
    projectQueryKeys.dashboardPrefix,
  ],
  defectConversion: [
    projectQueryKeys.tasks,
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
    }) => context.repository.updateTaskProgress(taskId, input),
    onSuccess: async () => {
      await invalidateKeys(
        queryClient,
        [
          projectQueryKeys.tasksFor(context.projectId),
          projectQueryKeys.ganttFor(context.projectId),
          projectQueryKeys.requirementsFor(context.projectId),
          projectQueryKeys.dashboardPrefixFor(context.projectId),
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
