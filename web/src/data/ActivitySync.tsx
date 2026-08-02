import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { ActivityEvent } from './domain'
import { projectQueryKeys, useProjectRepository } from './query-hooks'

function affectedQueryKeys(
  activity: ActivityEvent,
  selectedProjectId: string,
): readonly (readonly unknown[])[] {
  const projectId = activity.projectId ?? selectedProjectId
  const dashboard = projectQueryKeys.dashboardPrefixFor(projectId)
  const workspaceDashboard = projectQueryKeys.workspaceDashboardPrefix
  if (activity.operation.startsWith('actor.')) {
    return [projectQueryKeys.actors, dashboard, workspaceDashboard]
  }
  if (activity.operation.startsWith('project.')) {
    return [projectQueryKeys.projects, dashboard, workspaceDashboard]
  }
  if (activity.operation.startsWith('task.')) {
    return [
      projectQueryKeys.tasksFor(projectId),
      projectQueryKeys.allTasks,
      projectQueryKeys.ganttFor(projectId),
      projectQueryKeys.requirementsFor(projectId),
      dashboard,
      workspaceDashboard,
    ]
  }
  if (activity.operation.startsWith('requirement.')) {
    return [
      projectQueryKeys.requirementsFor(projectId),
      dashboard,
      workspaceDashboard,
    ]
  }
  if (activity.operation === 'defect.to_task') {
    return [
      projectQueryKeys.defectsFor(projectId),
      projectQueryKeys.tasksFor(projectId),
      projectQueryKeys.allTasks,
      projectQueryKeys.ganttFor(projectId),
      dashboard,
      workspaceDashboard,
    ]
  }
  if (activity.operation.startsWith('defect.')) {
    return [
      projectQueryKeys.defectsFor(projectId),
      dashboard,
      workspaceDashboard,
    ]
  }
  if (activity.operation === 'settings.update') {
    return [projectQueryKeys.settings]
  }
  return []
}

export function ActivitySync({ intervalMs = 3_000 }: { intervalMs?: number }) {
  const queryClient = useQueryClient()
  const { repository, projectId } = useProjectRepository()

  useEffect(() => {
    let cursor: string | undefined
    let initialized = false
    let disposed = false
    let activePoll: Promise<void> | undefined

    const performPoll = async () => {
      if (
        disposed
        || document.visibilityState !== 'visible'
      ) return
      let page
      try {
        page = await repository.listActivities(
          cursor === undefined ? {} : { after: cursor },
        )
      } catch {
        return
      }
      if (disposed) return
      cursor = page.nextCursor ?? cursor
      if (!initialized) {
        initialized = true
        return
      }
      const keys = page.items
        .filter((activity) => activity.source === 'mcp')
        .flatMap((activity) => affectedQueryKeys(activity, projectId))
      await Promise.all(
        keys.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })),
      )
    }

    const poll = async () => {
      if (activePoll !== undefined) return
      if (disposed) return
      const currentPoll = performPoll()
      activePoll = currentPoll
      try {
        await currentPoll
      } finally {
        if (activePoll === currentPoll) activePoll = undefined
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = window.setInterval(() => void poll(), intervalMs)
    void poll()

    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs, projectId, queryClient, repository])

  return null
}
