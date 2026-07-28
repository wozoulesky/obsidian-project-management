import { AppShell } from '../components/app-shell/AppShell'
import { AppRoutes } from './router'

export function App() {
  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  )
}
