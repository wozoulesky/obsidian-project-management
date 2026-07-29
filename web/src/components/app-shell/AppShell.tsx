import {
  Bug,
  ChartNoAxesGantt,
  Check,
  FolderKanban,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { NavLink } from 'react-router-dom'

import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { VisuallyHidden } from '../ui/VisuallyHidden'

type AppShellProps = {
  children?: ReactNode
}

const navigationItems = [
  { label: '仪表盘', path: '/dashboard', icon: LayoutDashboard },
  { label: '项目', path: '/projects', icon: FolderKanban },
  { label: '负责人', path: '/actors', icon: Users },
  { label: '计划 / 任务', path: '/tasks', icon: ListTodo },
  { label: '甘特图', path: '/gantt', icon: ChartNoAxesGantt },
  { label: '需求', path: '/requirements', icon: Lightbulb },
  { label: '缺陷', path: '/defects', icon: Bug },
  { label: '设置', path: '/settings', icon: Settings },
] as const

export function AppShell({ children }: AppShellProps) {
  const [isRailExpanded, setIsRailExpanded] = useState(false)
  const toggleLabel = isRailExpanded ? '收起侧边栏' : '展开侧边栏'

  return (
    <div
      className={`app-shell${isRailExpanded ? ' app-shell--rail-expanded' : ''}`}
    >
      <aside
        className={`app-rail${isRailExpanded ? ' app-rail--expanded' : ''}`}
      >
        <NavLink
          aria-label="Project OS"
          className="app-rail__brand"
          title="Project OS"
          to="/dashboard"
        >
          P
        </NavLink>
        <button
          aria-expanded={isRailExpanded}
          aria-label={toggleLabel}
          className="app-rail__toggle"
          onClick={() => setIsRailExpanded((isExpanded) => !isExpanded)}
          title={toggleLabel}
          type="button"
        >
          {isRailExpanded ? (
            <PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.8} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={1.8} />
          )}
        </button>
        <nav aria-label="主导航" className="app-rail__nav">
          {navigationItems.map(({ icon: Icon, label, path }) => (
            <NavLink
              aria-label={label}
              className={({ isActive }) =>
                `app-rail__link${isActive ? ' app-rail__link--active' : ''}`
              }
              key={path}
              title={isRailExpanded ? undefined : label}
              to={path}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              {isRailExpanded ? (
                <span className="app-rail__label">{label}</span>
              ) : (
                <VisuallyHidden>{label}</VisuallyHidden>
              )}
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

      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  )
}
