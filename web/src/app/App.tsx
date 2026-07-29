import { AppShell } from '../components/app-shell/AppShell'
import { ActivitySync } from '../data/ActivitySync'
import { httpProjectRepository } from '../data/http-project-repository'
import { ProjectRepositoryProvider } from '../data/query-hooks'
import { AppRoutes } from './router'

export function App() {
  return (
    <ProjectRepositoryProvider
      repository={httpProjectRepository}
      projectId="project_default"
    >
      <ActivitySync />
      <AppShell>
        <AppRoutes />
      </AppShell>
    </ProjectRepositoryProvider>
  )
}
