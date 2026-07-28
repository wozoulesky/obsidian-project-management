import { AppShell } from '../components/app-shell/AppShell'
import { AppRoutes } from './router'

export function App() {
  return (
    <div aria-label="本地项目管理系统" role="application">
      <AppShell>
        <AppRoutes />
      </AppShell>
    </div>
  )
}
