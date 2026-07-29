import { AppShell } from '../components/app-shell/AppShell'
import { ActivitySync } from '../data/ActivitySync'
import { ProjectRepositoryProvider } from '../data/query-hooks'
import { selectAppRepository } from './app-repository'
import { AppRoutes } from './router'
import { AppearanceProvider } from './AppearanceProvider'

const useE2eFixtures = import.meta.env.VITE_E2E_FIXTURES === 'true'
const appRepository = selectAppRepository(useE2eFixtures)

export function App() {
  return (
    <ProjectRepositoryProvider
      repository={appRepository}
      projectId={useE2eFixtures ? 'atlas' : 'project_default'}
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
