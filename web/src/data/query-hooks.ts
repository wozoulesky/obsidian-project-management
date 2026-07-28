import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  RequirementStatus,
  TaskDateInput,
  TaskProgressInput,
} from './domain'
import { createMockProjectRepository } from './mock-project-repository'

export const projectRepository = createMockProjectRepository()
export const projectId = 'atlas'

export const projectQueryKeys = {
  dashboardPrefix: ['dashboard', projectId] as const,
  dashboard: (days: 7 | 30 | 90) =>
    ['dashboard', projectId, days] as const,
  tasks: ['tasks', projectId] as const,
  requirements: ['requirements', projectId] as const,
  defects: ['defects', projectId] as const,
  gantt: ['gantt', projectId] as const,
}

export function useDashboard(days: 7 | 30 | 90 = 30) {
  return useQuery({
    queryKey: projectQueryKeys.dashboard(days),
    queryFn: () => projectRepository.getDashboard(projectId, days),
  })
}

export function useTasks() {
  return useQuery({
    queryKey: projectQueryKeys.tasks,
    queryFn: () => projectRepository.listTasks(projectId),
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks }),
        queryClient.invalidateQueries({
          queryKey: projectQueryKeys.dashboardPrefix,
        }),
      ])
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.gantt }),
      ])
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
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.requirements,
      })
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.defects }),
      ])
    },
  })
}

export function useGanttTasks() {
  return useQuery({
    queryKey: projectQueryKeys.gantt,
    queryFn: () => projectRepository.listGanttTasks(projectId),
  })
}
