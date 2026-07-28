import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type {
  RequirementStatus,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import { createMockProjectRepository } from './mock-project-repository'

export const projectRepository = createMockProjectRepository()
export const projectId = 'atlas'

const e2eFixtureStorageKey = 'project-os:e2e-fixture'
const e2eFixtureModes = ['tasks-error'] as const
type E2eFixtureMode = (typeof e2eFixtureModes)[number]

function readE2eFixtureMode(): E2eFixtureMode | null {
  const fixtureAccessEnabled =
    import.meta.env.DEV ||
    import.meta.env.VITE_E2E_FIXTURES === 'true'
  if (!fixtureAccessEnabled || typeof sessionStorage === 'undefined') {
    return null
  }

  try {
    const value = sessionStorage.getItem(e2eFixtureStorageKey)
    return e2eFixtureModes.some((mode) => mode === value)
      ? (value as E2eFixtureMode)
      : null
  } catch {
    return null
  }
}

export function resetProjectRepositoryForTests() {
  Object.assign(projectRepository, createMockProjectRepository())
}

export const projectQueryKeys = {
  dashboardPrefix: ['dashboard', projectId] as const,
  dashboard: (days: 7 | 30 | 90) =>
    ['dashboard', projectId, days] as const,
  tasks: ['tasks', projectId] as const,
  requirements: ['requirements', projectId] as const,
  defects: ['defects', projectId] as const,
  gantt: ['gantt', projectId] as const,
}

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
  return useQuery({
    queryKey: projectQueryKeys.dashboard(days),
    queryFn: () => projectRepository.getDashboard(projectId, days),
  })
}

export function useTasks() {
  const fixtureMode = readE2eFixtureMode()
  return useQuery({
    queryKey: projectQueryKeys.tasks,
    queryFn: () => {
      if (fixtureMode === 'tasks-error') {
        throw new Error('任务数据加载失败，请重试。')
      }
      return projectRepository.listTasks(projectId)
    },
    ...(fixtureMode === 'tasks-error' ? { retry: false } : {}),
  })
}

export function useUpdateTaskProgress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string
      input: TaskProgressInput
    }) => projectRepository.updateTaskProgress(taskId, input),
    onSuccess: async () => {
      await invalidateKeys(
        queryClient,
        mutationInvalidationKeys.taskProgress,
      )
    },
  })
}

export function useUpdateTaskDates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string
      input: TaskDateInput
    }) => projectRepository.updateTaskDates(taskId, input),
    onSuccess: async () => {
      await invalidateKeys(queryClient, mutationInvalidationKeys.taskDates)
    },
  })
}

export function useRequirements() {
  return useQuery({
    queryKey: projectQueryKeys.requirements,
    queryFn: () => projectRepository.listRequirements(projectId),
  })
}

export function useUpdateRequirementStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      requirementId,
      status,
    }: {
      requirementId: string
      status: RequirementStatus
    }) => projectRepository.updateRequirementStatus(requirementId, status),
    onSuccess: async () => {
      await invalidateKeys(
        queryClient,
        mutationInvalidationKeys.requirementStatus,
      )
    },
  })
}

export function useDefects() {
  return useQuery({
    queryKey: projectQueryKeys.defects,
    queryFn: () => projectRepository.listDefects(projectId),
  })
}

export function useCreateTaskFromDefect() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (defectId: string) =>
      projectRepository.createTaskFromDefect(defectId),
    onSuccess: async () => {
      await invalidateKeys(
        queryClient,
        mutationInvalidationKeys.defectConversion,
      )
    },
  })
}

export function useGanttTasks() {
  return useQuery({
    queryKey: projectQueryKeys.gantt,
    queryFn: () => projectRepository.listGanttTasks(projectId),
  })
}
