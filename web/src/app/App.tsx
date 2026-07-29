import { AppShell } from '../components/app-shell/AppShell'
import { ActivitySync } from '../data/ActivitySync'
import { ProjectRepositoryProvider } from '../data/query-hooks'
import {
  appProjectId,
  appRepository,
} from '#app-runtime'
import { AppRoutes } from './router'
import { AppearanceProvider } from './AppearanceProvider'

export function App() {
  return (
    <ProjectRepositoryProvider
      repository={appRepository}
      projectId={appProjectId}
    >
      <AppearanceProvider>
        <ActivitySync />
        <AppShell>
          <AppRoutes />
        </AppShell>
      </AppearanceProvider>
    </ProjectRepositoryProvider>
  )
}
