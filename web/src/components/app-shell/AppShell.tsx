import {
  Bug,
  ChartNoAxesGantt,
  Check,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  Plus,
  Settings,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { VisuallyHidden } from '../ui/VisuallyHidden'

type AppShellProps = {
  children?: ReactNode
}

const navigationItems = [
  { label: '仪表盘', path: '/dashboard', icon: LayoutDashboard },
  { label: '计划 / 任务', path: '/tasks', icon: ListTodo },
  { label: '甘特图', path: '/gantt', icon: ChartNoAxesGantt },
  { label: '需求', path: '/requirements', icon: Lightbulb },
  { label: '缺陷', path: '/defects', icon: Bug },
  { label: '设置', path: '/settings', icon: Settings },
] as const

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-rail">
        <NavLink
          aria-label="Project OS"
          className="app-rail__brand"
          title="Project OS"
          to="/dashboard"
        >
          P
        </NavLink>
        <nav aria-label="主导航" className="app-rail__nav">
          {navigationItems.map(({ icon: Icon, label, path }) => (
            <NavLink
              aria-label={label}
              className={({ isActive }) =>
                `app-rail__link${isActive ? ' app-rail__link--active' : ''}`
              }
              key={path}
              title={label}
              to={path}
            >
              <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
              <VisuallyHidden>{label}</VisuallyHidden>
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="app-header">
        <div className="app-header__project">
          <Badge tone="primary">PROJECT / LOCAL</Badge>
          <span className="app-header__project-name">Atlas 研发平台</span>
        </div>
        <div className="app-header__actions">
          <div className="app-header__save-status" role="status">
            <span className="app-header__save-message">
              <Check aria-hidden="true" size={15} />
              数据已保存到本地
            </span>
            <span className="app-header__updated">最后更新 10:42</span>
          </div>
          <Button variant="primary">
            <Plus aria-hidden="true" size={17} />
            快速提交
          </Button>
        </div>
      </header>

      <main className="app-main">{children}</main>
    </div>
  )
}
