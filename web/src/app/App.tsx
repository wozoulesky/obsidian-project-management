import type { Project, ProjectStatus } from '../data/domain'
import { LoadingState } from '../components/data/DataState'
import { AppShell } from '../components/app-shell/AppShell'
import { ActivitySync } from '../data/ActivitySync'
import {
  ProjectRepositoryProvider,
  useProjectRepository,
  useProjects,
  workspaceProjectStorageKey,
} from '../data/query-hooks'
import { useEffect, useState } from 'react'
import {
  appProjectId,
  appRepository,
} from '#app-runtime'
import { AppRoutes } from './router'
import { AppearanceProvider } from './AppearanceProvider'

const defaultProjectId = 'project_default'
const activeStatusPriority: readonly ProjectStatus[] = [
  'in_progress',
  'not_started',
  'on_hold',
]

function savedWorkspaceProjectId(): string | null {
  try {
    return sessionStorage.getItem(workspaceProjectStorageKey)
  } catch {
    return null
  }
}

function selectInitialProject(
  projects: readonly Project[],
  initialProjectId: string,
): string | undefined {
  const savedProjectId = savedWorkspaceProjectId()
  if (projects.some(({ id }) => id === savedProjectId)) {
    return savedProjectId ?? undefined
  }
  if (
    initialProjectId !== defaultProjectId
    && projects.some(({ id }) => id === initialProjectId)
  ) {
    return initialProjectId
  }
  for (const status of activeStatusPriority) {
    const activeProject = projects.find(
      (project) =>
        project.id !== defaultProjectId && project.status === status,
    )
    if (activeProject !== undefined) return activeProject.id
  }
  return projects.find(({ id }) => id !== defaultProjectId)?.id
    ?? projects.find(({ id }) => id === initialProjectId)?.id
    ?? projects[0]?.id
}

function WorkspaceProjectGate() {
  const projects = useProjects()
  const { projectId, selectProject } = useProjectRepository()
  const [isResolved, setIsResolved] = useState(false)

  useEffect(() => {
    if (isResolved || projects.isPending) return
    if (projects.data !== undefined) {
      const selectedProjectId = selectInitialProject(projects.data, projectId)
      if (
        selectedProjectId !== undefined
        && selectedProjectId !== projectId
      ) {
        selectProject(selectedProjectId)
      }
    }
    setIsResolved(true)
  }, [isResolved, projectId, projects.data, projects.isPending, selectProject])

  if (!isResolved) return <LoadingState />
  return (
    <AppearanceProvider>
      <ActivitySync />
      <AppShell>
        <AppRoutes />
      </AppShell>
    </AppearanceProvider>
  )
}

export function App() {
  return (
    <ProjectRepositoryProvider
      repository={appRepository}
      projectId={appProjectId}
    >
      <WorkspaceProjectGate />
    </ProjectRepositoryProvider>
  )
}
