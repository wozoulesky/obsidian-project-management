# Project OS Prototype Fidelity Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实 React 前端在 1440×900 下忠实复现已批准多页原型的固定母版、首屏信息架构和交互关系，同时让项目级页面读取用户明确选择的真实项目，而不是固定的空 `project_default`。

**Architecture:** 保留 BrowserRouter、React Query、真实 Repository、持久化 mutation 与现有九条路由。先把 `ProjectRepositoryProvider` 从只读项目 ID 改为可切换的工作区项目上下文；随后恢复固定 220px 桌面母版，按原型重新组合 Dashboard 和 Tasks，最后用 viewport 几何断言与人工批准的截图基线锁住视觉契约。项目详情选择器仍只切换 `/projects/:id`，不会静默改变全局工作区项目。

**Tech Stack:** React 19, React Router 7, TanStack Query, TypeScript 6, Vite 8, Vitest + Testing Library, Playwright, Express, SQLite.

---

## Approved source of truth

- Visual and interaction contract: `docs/prototypes/project-os-multipage-preview.html`
- Approved representative image: `docs/prototypes/project-os-multipage-preview.png`
- Design rationale: `docs/superpowers/specs/2026-08-01-multi-page-visual-system-design.md`
- Existing application behavior remains authoritative for mutations, errors, focus recovery, permissions and real data.

## Root-cause constraints

- Desktop navigation is fixed and expanded at 1440/1280; the current default-collapsed behavior is a regression.
- The global `app-header` with hard-coded `Atlas 研发平台` and `10:42` is not part of the approved mother layout and must not consume desktop first-screen height.
- `appProjectId = 'project_default'` is only an initial compatibility value. Project-scoped queries must follow an explicit workspace selection.
- Dashboard is a compact portfolio overview with a shared risk/actor context panel; it is not a 2162px vertical report.
- Tasks uses list + fan + context as a three-column workspace, followed by an independent delivery timeline; a full-width table must not replace that signature layout.
- Full-page screenshots are regression evidence only. The design gate is a 1440×900 viewport screenshot plus geometry assertions.

## File boundaries

- Project scope: `web/src/data/query-hooks.ts`, `web/src/app/App.tsx`, `web/src/app/app-runtime.ts`, `web/src/data/repository-default.ts`, focused tests.
- Shell: `web/src/components/app-shell/**`, `web/src/styles/glass-shell.css`, `web/src/styles/glass-responsive.css`.
- Dashboard: only `web/src/features/dashboard/**` plus focused E2E assertions.
- Tasks: only `web/src/features/tasks/**` plus focused E2E assertions.
- Cross-page visual gates: `web/e2e/prototype-contract.spec.ts`, `web/e2e/visual-helpers.ts`, Playwright snapshots after manual comparison.

### Task 1: Make workspace project scope explicit and switchable

**Files:**
- Modify: `web/src/data/query-hooks.ts`
- Modify: `web/src/app/App.tsx`
- Modify: `web/src/app/app-runtime.ts`
- Modify: `web/src/data/repository-default.ts`
- Test: `web/src/data/query-hooks.test.tsx`
- Test: `web/src/app/App.test.tsx`

- [ ] **Step 1: Write the failing context-switch test**

Add a probe that reads the current context and calls the desired API:

```tsx
function ProjectScopeProbe() {
  const { projectId, selectProject } = useProjectRepository()
  const tasks = useTasks()
  return (
    <>
      <output aria-label="当前项目">{projectId}</output>
      <output aria-label="任务数">{tasks.data?.length ?? 0}</output>
      <button onClick={() => selectProject('project-petlog')}>选择 PetLog</button>
    </>
  )
}

it('switches project-scoped queries without mixing caches', async () => {
  const repository = createMockProjectRepository()
  const listTasks = vi.spyOn(repository, 'listTasks')
  renderWithQueryClient(
    <ProjectRepositoryProvider repository={repository} projectId="project_default">
      <ProjectScopeProbe />
    </ProjectRepositoryProvider>,
  )
  expect(await screen.findByLabelText('当前项目')).toHaveTextContent('project_default')
  await userEvent.click(screen.getByRole('button', { name: '选择 PetLog' }))
  expect(await screen.findByLabelText('当前项目')).toHaveTextContent('project-petlog')
  expect(listTasks).toHaveBeenCalledWith('project_default')
  expect(listTasks).toHaveBeenCalledWith('project-petlog')
})
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test --workspace web -- src/data/query-hooks.test.tsx
```

Expected: FAIL because `selectProject` does not exist and the provider value is read-only.

- [ ] **Step 3: Implement the minimal dynamic provider**

Extend the context without changing Repository methods:

```ts
type ProjectRepositoryContextValue = {
  repository: ProjectRepository
  projectId: string
  selectProject(projectId: string): void
}

export function ProjectRepositoryProvider({ children, repository, projectId }: Props) {
  const parent = useContext(ProjectRepositoryContext)
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  if (parent !== null) return children
  return createElement(ProjectRepositoryContext.Provider, {
    value: {
      repository,
      projectId: selectedProjectId,
      selectProject: setSelectedProjectId,
    },
  }, children)
}
```

The fallback `useProjectRepository()` value must expose a no-op-free selector backed by the real provider; production `App` must always render the provider. Keep `projectQueryKeys.*For(projectId)` unchanged so React Query naturally separates caches.

- [ ] **Step 4: Add production selection validation**

In `App.tsx`, use `useProjects()` inside the provider boundary to validate the initial ID. When `project_default` has no meaningful workspace data and another active project exists, select the first non-default active project. Do not add a backend field or silently change the selection from `/projects/:id`.

```ts
const fallbackProject = projects.find(
  (project) => project.id !== appProjectId && project.status === 'active',
) ?? projects.find((project) => project.id !== appProjectId) ?? projects[0]
```

Persist an explicit shell selection in `sessionStorage` under `project-os:workspace-project`; validate it against the current project list before using it.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm test --workspace web -- src/data/query-hooks.test.tsx src/app/App.test.tsx
npm run build --workspace web
git diff --check
git add web/src/data/query-hooks.ts web/src/app/App.tsx web/src/app/app-runtime.ts web/src/data/repository-default.ts web/src/data/query-hooks.test.tsx web/src/app/App.test.tsx
git commit -m "fix: make workspace project scope selectable"
```

### Task 2: Restore the approved fixed desktop shell

**Files:**
- Modify: `web/src/components/app-shell/AppShell.tsx`
- Modify: `web/src/components/app-shell/AppShell.test.tsx`
- Modify: `web/src/styles/glass-shell.css`
- Modify: `web/src/styles/glass-responsive.css`
- Modify: `web/e2e/projects-actors-settings.spec.ts`

- [ ] **Step 1: Replace the regression test with the approved shell contract**

```tsx
it('renders the complete desktop mother layout without an extra global header', async () => {
  renderApp(<AppShell><div>内容</div></AppShell>)
  expect(screen.getByText('Project OS')).toBeVisible()
  expect(screen.getByText('概览')).toBeVisible()
  expect(screen.getByText('交付')).toBeVisible()
  expect(screen.getByText('质量')).toBeVisible()
  expect(screen.getByText('系统')).toBeVisible()
  expect(screen.getByRole('region', { name: '当前工作区' })).toBeVisible()
  expect(screen.getByRole('region', { name: '当前负责人' })).toBeVisible()
  expect(document.querySelector('.app-header')).not.toBeInTheDocument()
  expect(screen.queryByText('Atlas 研发平台')).not.toBeInTheDocument()
  expect(screen.queryByText('最后更新 10:42')).not.toBeInTheDocument()
})
```

Also assert that selecting a real project calls `selectProject(project.id)` and updates the displayed project name.

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace web -- src/components/app-shell/AppShell.test.tsx
```

Expected: FAIL because the shell starts collapsed, lacks workspace/owner cards and renders the hard-coded global header.

- [ ] **Step 3: Implement the fixed shell**

Use this desktop grid contract:

```css
.app-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 100dvh;
  overflow-x: clip;
}

.app-rail {
  position: sticky;
  top: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
}

.app-main {
  grid-column: 2;
  min-width: 0;
  padding: 28px 38px 40px;
}
```

Remove the desktop expand/collapse state and the `app-header`. Keep Quick Submit functional by placing its trigger in the workspace card. The workspace card contains a real project `<select>` sourced from `useProjects()`; the owner card uses `useCurrentActor()`. Preserve the skip link, active `NavLink`, dialog focus restoration and compact navigation behavior.

- [ ] **Step 4: Add responsive shell rules**

At widths below 48rem, convert the rail to the existing local bottom/horizontal navigation, hide descriptive footer cards, and leave `main` at grid column 1. At 1280 and 1440 the 220px rail and all labels remain visible.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm test --workspace web -- src/components/app-shell/AppShell.test.tsx src/app/App.test.tsx
npm run lint --workspace web
npm run build --workspace web
git diff --check
git add web/src/components/app-shell web/src/styles/glass-shell.css web/src/styles/glass-responsive.css web/e2e/projects-actors-settings.spec.ts
git commit -m "fix: restore approved desktop mother layout"
```

### Task 3: Recompose Dashboard into the approved compact decision surface

**Files:**
- Modify: `web/src/features/dashboard/DashboardPage.tsx`
- Modify: `web/src/features/dashboard/DashboardPage.test.tsx`
- Modify: `web/src/features/dashboard/MetricBand.tsx`
- Modify: `web/src/features/dashboard/PortfolioHealthStage.tsx`
- Modify: `web/src/features/dashboard/AgentPresence.tsx`
- Modify: `web/src/features/dashboard/dashboard-glass.css`

- [ ] **Step 1: Write failing structure and shared-context tests**

```tsx
it('matches the approved dashboard composition and shared context', async () => {
  const { container } = renderApp(<DashboardPage />)
  const detail = await screen.findByTestId('dashboard-detail-grid')
  expect(detail.children).toHaveLength(2)
  const ops = within(detail).getByTestId('dashboard-ops-grid')
  expect(within(ops).getByRole('region', { name: '风险队列' })).toBeVisible()
  expect(within(ops).getByRole('region', { name: '协作者状态' })).toBeVisible()
  expect(within(detail).getByRole('region', { name: '上下文摘要' })).toBeVisible()
  expect(container.querySelector('.dashboard-relay')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /选择风险/ }))
  expect(within(detail).getByRole('region', { name: '上下文摘要' }))
    .toHaveTextContent('风险级别')
  await userEvent.click(screen.getByRole('button', { name: /选择协作者/ }))
  expect(within(detail).getByRole('region', { name: '上下文摘要' }))
    .toHaveTextContent('工作负载')
})
```

Add a metric test that all four values are workspace-level: project count, active project count, total open risks across the portfolio snapshot, and active collaborators.

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace web -- src/features/dashboard/DashboardPage.test.tsx
```

Expected: FAIL because Dashboard vertically stacks Agent Relay/Risk/Activity, has no actor selection and mixes workspace/current-project metric scopes.

- [ ] **Step 3: Implement the approved composition**

Render in this order:

```tsx
<PageHeader />
<MetricBand />
<PortfolioHealthStage />
<div className="dashboard-detail-grid" data-testid="dashboard-detail-grid">
  <div className="dashboard-ops-grid" data-testid="dashboard-ops-grid">
    <RiskQueue />
    <AgentPresence selectable />
  </div>
  <DashboardContextPanel selection={selection} />
</div>
<div className="dashboard-feed-grid">
  <RecentDeliverables />
  <ActivityFeed />
</div>
```

Selection is a discriminated union `{ type: 'risk' | 'actor'; id: string }`. Default to the highest available risk, otherwise the first active actor. Re-resolve the selection whenever the snapshot changes. Remove the separate `dashboard-relay` heading and the full-width risk table from the Dashboard composition; do not delete reusable components that other routes may need.

- [ ] **Step 4: Restore prototype-scale visual density**

At 1440px use a 7-column signature stage, a `minmax(0, 2fr) minmax(280px, 1fr)` detail grid, restrained 14–18px panel gaps, silver top highlights and a single teal focus. The Health stage must use the existing real data but fit within roughly 290px height. The risk, actor and context panels must begin within the 900px viewport.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npm test --workspace web -- src/features/dashboard
npm run build --workspace web
git diff --check
git add web/src/features/dashboard
git commit -m "fix: align dashboard with approved prototype"
```

### Task 4: Restore the task console three-column signature layout

**Files:**
- Create: `web/src/features/tasks/TaskCompactList.tsx`
- Create: `web/src/features/tasks/TaskContextPanel.tsx`
- Modify: `web/src/features/tasks/TaskPage.tsx`
- Modify: `web/src/features/tasks/TaskPage.test.tsx`
- Modify: `web/src/features/tasks/TaskFan.tsx`
- Modify: `web/src/features/tasks/TaskFan.test.tsx`
- Modify: `web/src/features/tasks/DeliveryTimeline.tsx`
- Modify: `web/src/features/tasks/DeliveryTimeline.test.tsx`
- Modify: `web/src/features/tasks/TaskInspector.tsx`
- Modify: `web/src/features/tasks/tasks-glass.css`

- [ ] **Step 1: Write the failing three-column structure test**

```tsx
it('renders list, fan and persistent context before the independent timeline', async () => {
  const { container } = renderApp(<TaskPage />)
  const workspace = await screen.findByTestId('task-workspace')
  expect(Array.from(workspace.children).map((node) => node.getAttribute('data-slot')))
    .toEqual(['list', 'fan', 'context'])
  expect(within(workspace).getByRole('region', { name: '任务列表' })).toBeVisible()
  expect(within(workspace).getByRole('region', { name: '关键任务扇面' })).toBeVisible()
  expect(within(workspace).getByRole('region', { name: '智能任务上下文' })).toBeVisible()
  expect(screen.getByRole('region', { name: '独立交付时间线' }))
    .toBe(container.querySelector('.task-workspace')?.nextElementSibling)
})
```

Add assertions that the first prioritized visible task is selected by default in list, fan and context without opening a dialog.

- [ ] **Step 2: Write failing priority and timeline-range tests**

The fan candidate order is: overdue, in progress, not started, done; then P0–P3; then due date ascending. A completed P3 task with an earlier due date must not displace an overdue P0 task.

```ts
expect(prioritizeFanTasks(tasks).slice(0, 2).map(({ id }) => id))
  .toEqual(['overdue-p0', 'active-p0'])
```

Delivery Timeline must expose 周/月/季度 controls and filter only timeline nodes, without altering the task workspace.

- [ ] **Step 3: Verify RED**

```powershell
npm test --workspace web -- src/features/tasks/TaskPage.test.tsx src/features/tasks/TaskFan.test.tsx src/features/tasks/DeliveryTimeline.test.tsx
```

Expected: FAIL because the current page renders fan + timeline above a full-width table, no persistent context, no priority derivation and no independent time range.

- [ ] **Step 4: Implement compact list and persistent context**

`TaskCompactList` renders a locally scrollable button list from the same `filteredTasks`; selection updates the existing `selected` URL query. `TaskContextPanel` reuses the progress fields currently inside `TaskInspector` but renders as a named `<section>` rather than a dialog. Keep `TaskInspector` for deep/modal entry points elsewhere.

```tsx
<div className="task-workspace" data-testid="task-workspace">
  <TaskCompactList data-slot="list" ... />
  <TaskFan data-slot="fan" ... />
  <TaskContextPanel data-slot="context" task={selectedTask} />
</div>
<DeliveryTimeline ariaLabel="独立交付时间线" ... />
```

If the URL has no valid selection, derive `selectedTask` from the first prioritized visible task without forcing a history entry. A click still writes `selected=<id>` and preserves filters.

- [ ] **Step 5: Implement the independent timeline range**

Keep range state local to `DeliveryTimeline`. Week uses today ± 7 days, month uses the current calendar month, quarter uses the current quarter. Each range renders tasks whose due date falls within the range; controls use `aria-pressed`.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npm test --workspace web -- src/features/tasks
npm run lint --workspace web
npm run build --workspace web
git diff --check
git add web/src/features/tasks
git commit -m "fix: restore task console signature workspace"
```

### Task 5: Apply the shared mother-layout contract to the remaining pages

**Files:**
- Modify tests and CSS only where contract failures are observed under:
  - `web/src/features/projects/**`
  - `web/src/features/actors/**`
  - `web/src/features/gantt/**`
  - `web/src/features/requirements/**`
  - `web/src/features/defects/**`
  - `web/src/features/settings/**`

- [ ] **Step 1: Add route composition tests before changing production code**

For each route assert exactly one `PageHeader`, one signature region and at most one context panel. The signature names are fixed:

```ts
const contracts = [
  ['/projects', '项目矩阵'],
  ['/projects/atlas', '阶段里程碑'],
  ['/actors', '协作者网络'],
  ['/gantt', '甘特排程'],
  ['/requirements', '需求管线'],
  ['/defects', '缺陷矩阵'],
  ['/settings', '设置中心'],
] as const
```

At 1440px each page must use the shared 220px shell and place its context beside the signature where the prototype does so. Settings remains a restrained two-column configuration layout.

- [ ] **Step 2: Verify RED for observed deviations only**

```powershell
npm test --workspace web -- src/features/projects src/features/actors src/features/gantt src/features/requirements src/features/defects src/features/settings
```

Any test that already passes requires no production change. Do not restyle unrelated behavior.

- [ ] **Step 3: Make the minimum page/CSS changes and verify GREEN**

Preserve existing project creation/deletion, actor actions, Gantt scheduling, requirement DnD, defect conversion and settings persistence. Changes are limited to page composition, density and shared context placement.

- [ ] **Step 4: Commit**

```powershell
npm test --workspace web -- src/features/projects src/features/actors src/features/gantt src/features/requirements src/features/defects src/features/settings
npm run build --workspace web
git diff --check
git add web/src/features/projects web/src/features/actors web/src/features/gantt web/src/features/requirements web/src/features/defects web/src/features/settings
git commit -m "fix: align remaining pages with shared prototype shell"
```

### Task 6: Replace self-referential screenshots with prototype-contract gates

**Files:**
- Create: `web/e2e/prototype-contract.spec.ts`
- Modify: `web/e2e/visual-helpers.ts`
- Modify: `web/e2e/responsive-keyboard.spec.ts`
- Modify: `web/playwright.config.ts`
- Modify snapshots only after manual comparison with `docs/prototypes/*.png`

- [ ] **Step 1: Write failing 1440×900 geometry assertions**

```ts
test('desktop mother layout and dashboard core stay in the first viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyDashboard(page)
  await expect(page.locator('.app-rail')).toHaveCSS('width', '220px')
  const context = await page.getByRole('region', { name: '上下文摘要' }).boundingBox()
  expect(context).not.toBeNull()
  expect(context!.y).toBeLessThan(900)
  expect(context!.x).toBeGreaterThan(700)
})

test('task signature workspace is visible at 1440 by 900', async ({ page }) => {
  await page.goto('/tasks')
  const workspace = await page.getByTestId('task-workspace').boundingBox()
  const timeline = await page.getByRole('region', { name: '独立交付时间线' }).boundingBox()
  expect(workspace).not.toBeNull()
  expect(timeline).not.toBeNull()
  expect(timeline!.y).toBeLessThan(900)
})
```

- [ ] **Step 2: Verify RED against the current frontend**

```powershell
npm run test:e2e --workspace web -- prototype-contract.spec.ts --project=desktop
```

Expected: FAIL because the rail is collapsed, Dashboard context begins below the viewport and Tasks has no approved three-column workspace.

- [ ] **Step 3: Add viewport screenshots**

Use `fullPage: false` for the contract images at 1440×900, 1280×800, 600×900 and 390×844. Keep existing full-page snapshots separately for regression. Do not run `--update-snapshots` until the 1440 screenshots have been visually compared with the approved prototype image.

- [ ] **Step 4: Run the full verification gate**

```powershell
npm run check
npm run test:e2e --workspace web -- --project=desktop
npm run test:e2e --workspace web -- --project=compact
npm run test:e2e --workspace web -- --project=real-browser-journeys
npm run test:e2e
git diff --check
git status --short
```

- [ ] **Step 5: Commit verified visual evidence**

```powershell
git add web/e2e web/playwright.config.ts
git commit -m "test: lock approved prototype fidelity"
```

## Plan self-review

- Spec coverage: fixed 220px mother layout, real workspace project selection, Dashboard shared context, Tasks three-column signature, all remaining routes, 1440/1280/600/390 responsive states and visual evidence are mapped to Tasks 1–6.
- Placeholder scan: no TBD, TODO or deferred implementation instruction remains.
- Type consistency: `selectProject(projectId: string): void` is defined in Task 1 and consumed by AppShell in Task 2; existing scoped hooks continue reading `context.projectId`.
- Product semantics: `/projects/:id` remains canonical for detail navigation and does not silently change the global workspace project.
- TDD order: every production task begins with a focused failing test and explicit RED command.
- Scope discipline: no backend schema change is required; real project endpoints and query-key isolation already exist.
