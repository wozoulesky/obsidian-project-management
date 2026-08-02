# Project OS Web Glass Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已批准的九页黑银玻璃原型落地到现有 React Web 应用，同时保留 BrowserRouter、React Query、真实 Repository、持久化 mutation、键盘交互和错误恢复能力。

**Architecture:** 原型仅作为视觉与页面编排契约，不复制静态 fixture、hash router 或假操作。共享基座先冻结玻璃语义 token、Shell 和布局组件；后端只增加当前本地操作者只读接口；随后三个互不冲突的页面线程分别拥有 Overview、Execution、Quality/Settings feature 目录，最后由单一集成线程处理 E2E、快照和全量门禁。

**Tech Stack:** React 19, React Router 7, TanStack Query/Table/Virtual, TypeScript 6, Vite 8, Vitest + Testing Library, Playwright + axe-core, Express, Zod, SQLite。

---

## Approved source of truth

- Visual contract: `docs/prototypes/project-os-multipage-preview.html`
- Representative image: `docs/prototypes/project-os-multipage-preview.png`
- Design rationale: `docs/superpowers/specs/2026-08-01-multi-page-visual-system-design.md`
- Existing application behavior remains authoritative for data, mutations, permissions, version concurrency, focus management, errors, loading states, settings persistence, and browser routing.

## Thread topology and ownership

```text
Wave 1 (parallel)
├─ DATA: current actor endpoint + repository/hook
└─ SHELL: glass tokens + shared layout + AppShell

Wave 2 (parallel after Wave 1 contracts freeze)
├─ OVERVIEW: dashboard + projects + project detail + actors
├─ EXECUTION: tasks + gantt
└─ QUALITY: requirements + defects + settings

Wave 3 (serial)
└─ INTEGRATION: route coverage + responsive/a11y + real runtime + visual baselines
```

No page worker may modify `web/src/styles/components.css`, `web/src/styles/responsive.css`, `web/src/app/router.tsx`, `web/src/data/**`, `web/e2e/**`, root package files, or another worker's feature directory. Shared-file changes belong to SHELL, DATA, or INTEGRATION only.

## Non-negotiable product semantics

- Preserve all nine BrowserRouter URLs and lazy loading.
- `/projects/:id` is the canonical selected-project detail URL. Project switching navigates to another `/projects/:id`; it does not silently change the global workspace project.
- Preserve Quick Submit, ActivitySync, cached stale-data refresh states, dialogs, DnD, virtual tables, Gantt scheduling, versioned mutations, settings persistence, actor deactivation, and defect-to-task conversion.
- Derive milestones from `Task.milestoneId`; derive actor collaboration from shared project/task evidence; show defects as severity × status. Do not invent domain fields.
- Dark + teal is the new-workspace default visual; light/system modes remain supported through semantic glass tokens.
- Red is reserved for critical/fatal/overdue conditions. Green/teal marks selected, active, success, and progress.
- Complex views use local scrolling; the document must never overflow horizontally at 390, 600, 1280, or 1440 pixels.

### Task 1: Expose the current local actor through the real data path

**Owner:** DATA thread

**Files:**
- Modify: `apps/server/src/routes/actors.ts`
- Test: `apps/server/src/routes/work-routes.test.ts`
- Modify: `web/src/data/project-repository.ts`
- Modify: `web/src/data/http-project-repository.ts`
- Modify: `web/src/data/mock-project-repository.ts`
- Modify: `web/src/data/query-hooks.ts`
- Test: `web/src/data/http-project-repository.test.ts`
- Test: `web/src/data/query-hooks.test.tsx`

- [ ] **Step 1: Write the failing server route test**

Add an actor-route test before the existing `/:id` coverage:

```ts
it('returns the configured local actor without accepting an actor id', async () => {
  const local = defaultSeedDocument.actors[0]!
  const { api } = createApi(createContext(true, local.id))

  const response = await api.get('/api/v1/actors/current').expect(200)

  expect(persistedActorSchema.parse(response.body.data).id).toBe(local.id)
  expectRequestEnvelope(response)
})
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test --workspace @project-os/server -- work-routes.test.ts
```

Expected: FAIL because `/actors/current` is consumed as an actor ID or returns not found.

- [ ] **Step 3: Add the literal route before `/:id`**

Implement a read-only handler that obtains `context.localActorId`, calls the existing actor service, parses the result with `persistedActorSchema`, and returns the standard success envelope. Do not accept a client actor ID and do not add a mutation.

- [ ] **Step 4: Write failing Repository and hook tests**

Add the desired API contract:

```ts
export interface ProjectRepository {
  getCurrentActor(): Promise<Actor>
  // existing methods remain unchanged
}
```

Test that the HTTP implementation requests `/actors/current`, the mock returns the configured local owner, and `useCurrentActor()` uses query key `['actors', 'current']`.

- [ ] **Step 5: Verify RED, implement, and verify GREEN**

Run:

```powershell
npm test --workspace web -- src/data/http-project-repository.test.ts src/data/query-hooks.test.tsx
npm test --workspace @project-os/server -- work-routes.test.ts
```

Expected after implementation: all focused tests pass, and no existing Repository method changes signature.

- [ ] **Step 6: Run DATA gate and commit**

```powershell
npm test --workspace web -- src/data
npm test --workspace @project-os/server -- work-routes.test.ts
npm run build --workspace web
git diff --check
git add apps/server/src/routes/actors.ts apps/server/src/routes/work-routes.test.ts web/src/data
git commit -m "feat: expose current actor to web"
```

### Task 2: Build the shared glass foundation and application shell

**Owner:** SHELL thread

**Files:**
- Modify: `web/src/styles/tokens.css`
- Modify: `web/src/styles/base.css`
- Create: `web/src/styles/glass-foundation.css`
- Create: `web/src/styles/glass-shell.css`
- Create: `web/src/styles/glass-responsive.css`
- Modify: `web/src/main.tsx`
- Create: `web/src/components/layout/PageHeader.tsx`
- Create: `web/src/components/layout/MetricGrid.tsx`
- Create: `web/src/components/ui/GlassPanel.tsx`
- Create: `web/src/components/ui/SegmentedControl.tsx`
- Test: `web/src/components/layout/layout-components.test.tsx`
- Modify: `web/src/components/app-shell/AppShell.tsx`
- Test: `web/src/components/app-shell/AppShell.test.tsx`
- Modify: `web/src/components/charts/TrendChart.tsx`
- Modify: `web/src/components/charts/StatusDonut.tsx`
- Test: `web/src/components/charts/charts.test.tsx`

- [ ] **Step 1: Write failing shared-component tests**

Cover these observable contracts:

```tsx
render(<PageHeader eyebrow="PROJECT OS / DASHBOARD" title="全局驾驶舱" subtitle="项目健康" />)
expect(screen.getByRole('heading', { level: 1, name: '全局驾驶舱' })).toBeVisible()

render(<SegmentedControl ariaLabel="范围" value="all" options={[{ value: 'all', label: '全部' }]} onChange={onChange} />)
expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')
```

Also assert `GlassPanel` accepts a semantic `section` element and `MetricGrid` exposes an accessible label.

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace web -- src/components/layout/layout-components.test.tsx
```

Expected: FAIL because the shared layout components do not exist.

- [ ] **Step 3: Implement semantic glass tokens and components**

Add semantic tokens rather than hard-coding prototype colors inside pages:

```css
:root {
  --glass-canvas: #f2f5f3;
  --glass-surface: rgb(255 255 255 / 78%);
  --glass-surface-raised: rgb(255 255 255 / 90%);
  --glass-line: rgb(23 32 27 / 14%);
  --glass-line-bright: rgb(23 32 27 / 28%);
  --glass-shadow: 0 24px 70px rgb(15 24 19 / 14%);
  --glass-panel-radius: 1.25rem;
  --glass-card-radius: 0.875rem;
}

:root[data-theme="dark"] {
  --canvas: #030504;
  --surface: #121614;
  --rail: #060907;
  --text-primary: #f3f7f4;
  --text-secondary: #8d9791;
  --border: rgb(226 240 233 / 16%);
  --glass-canvas: #030504;
  --glass-surface: rgb(18 22 20 / 74%);
  --glass-surface-raised: rgb(28 33 30 / 82%);
  --glass-line: rgb(226 240 233 / 16%);
  --glass-line-bright: rgb(245 255 250 / 34%);
  --glass-shadow: 0 24px 70px rgb(0 0 0 / 52%);
}

:root[data-theme="dark"][data-accent="teal"] {
  --primary: #37f58a;
}
```

Keep existing light, system, accent, density, background, and reduced-motion behavior.

- [ ] **Step 4: Write failing AppShell tests**

Extend existing tests to require grouped labels `概览 / 交付 / 质量 / 系统`, full `Project OS` brand, offline/local status, `main#main-content`, active links, Quick Submit, Escape behavior, and horizontal local navigation below 48rem. Existing navigation and quick-submit tests must remain.

- [ ] **Step 5: Implement the shell without changing routes**

Use the existing `navigationItems` and `NavLink`; add group metadata and desktop labels. Keep mobile as local horizontal/bottom navigation, keep QuickSubmitDialog focus restoration, and add a skip link targeting `main-content`.

- [ ] **Step 6: Make ECharts consume semantic tokens**

Tests must prove chart options use current CSS variables for text, grid, primary, success, warning, and critical colors. Theme changes must produce new options rather than retaining hard-coded blue/dark text.

- [ ] **Step 7: Run SHELL gate and commit**

```powershell
npm test --workspace web -- src/components src/app/App.test.tsx
npm run lint --workspace web
npm run build --workspace web
git diff --check
git add web/src/styles web/src/main.tsx web/src/components
git commit -m "feat: add shared glass application shell"
```

### Task 3: Refactor Dashboard, Projects, Project Detail, and Actors

**Owner:** OVERVIEW thread

**Depends on:** Tasks 1 and 2

**Files:**
- Modify/Create only under `web/src/features/dashboard/**`
- Modify/Create only under `web/src/features/projects/**`
- Modify/Create only under `web/src/features/actors/**`

Expected new files:
- `web/src/features/dashboard/PortfolioHealthStage.tsx`
- `web/src/features/dashboard/dashboard-glass.css`
- `web/src/features/projects/ProjectSummaryPanel.tsx`
- `web/src/features/projects/MilestoneTrack.tsx`
- `web/src/features/projects/projects-glass.css`
- `web/src/features/actors/ActorNetwork.tsx`
- `web/src/features/actors/actors-glass.css`

- [ ] **Step 1: Write failing Dashboard composition tests**

Assert the real page renders a `PageHeader`, four workspace metrics derived from existing queries, a health stage, risk selection context, actor presence, deliverables, and activity. Empty/error/refresh tests remain intact. Do not assert prototype fixture values.

- [ ] **Step 2: Implement Dashboard using existing hooks and children**

Recompose `MetricBand`, chart components, `RiskQueue`, `AgentPresence`, `LatestHandoff`, `RecentDeliverables`, and `ActivityFeed`. Selection state is local UI state; data remains React Query state.

- [ ] **Step 3: Write failing Projects matrix and detail-link tests**

Cover:

```tsx
await user.click(screen.getByRole('button', { name: /查看 .* 摘要/ }))
expect(screen.getByRole('region', { name: /项目摘要/ })).toHaveTextContent(project.name)
expect(screen.getByRole('link', { name: /查看项目/ })).toHaveAttribute('href', `/projects/${project.id}`)
```

Keep URL search/owner filters, CreateProjectDialog, DeleteProjectDialog, and project links.

- [ ] **Step 4: Add project selector and derived milestone track to detail**

Write RED tests that select another project and expect navigation to `/projects/<id>`. The selector uses `useProjects()` and `useNavigate()`; the detail body continues using the route parameter. Derive milestone groups only from tasks with non-empty `milestoneId`; no milestone data renders an explicit empty state.

Also add existing `useProjectHandoffs()` and `useProjectDeliverables()` to the detail page, preserving member display and task creation.

- [ ] **Step 5: Write failing Actor network tests and implement evidence-based edges**

Use `useCurrentActor()`, actors, projects, and all tasks. Nodes expose status/capabilities and derived open-task count. Edges exist only when actors share project ownership/assignment evidence. Provide a screen-reader relationship list and retain create/edit/deactivate/copy actions below the signature stage.

- [ ] **Step 6: Run OVERVIEW gate and commit**

```powershell
npm test --workspace web -- src/features/dashboard src/features/projects src/features/actors
npm run lint --workspace web
npm run build --workspace web
git diff --check
git add web/src/features/dashboard web/src/features/projects web/src/features/actors
git commit -m "feat: refactor overview project pages"
```

### Task 4: Refactor Tasks and Gantt without replacing business components

**Owner:** EXECUTION thread

**Depends on:** Tasks 1 and 2

**Files:**
- Modify/Create only under `web/src/features/tasks/**`
- Modify/Create only under `web/src/features/gantt/**`

Expected new files:
- `web/src/features/tasks/TaskFan.tsx`
- `web/src/features/tasks/DeliveryTimeline.tsx`
- `web/src/features/tasks/tasks-glass.css`
- `web/src/features/gantt/gantt-glass.css`

- [ ] **Step 1: Write failing TaskFan behavior tests**

The first six filtered tasks render as full-size buttons; selecting a fan card updates URL query `selected=<taskId>`, the existing table selection, and `TaskInspector`. All visible card regions must belong to their own button. Empty filtered results render the existing empty state.

- [ ] **Step 2: Implement Task page composition**

Keep `TaskFilters`, `TaskTable`, `TaskInspector`, update-progress mutation, and URL state. Add four derived metrics, TaskFan, and a read-only delivery timeline using the same filtered tasks. Reduced-motion removes fan transforms but not content.

- [ ] **Step 3: Write failing Gantt shell tests**

Keep week/month/quarter controls, tree expand/collapse, proposal confirm/cancel, dependency connectors, keyboard access, virtualization, and error rollback. Add assertions for shared header, metrics, local scroll stage, and status legend.

- [ ] **Step 4: Restyle Gantt without modifying scheduling algorithms**

Do not change `gantt-layout.ts` or `GanttTimeline.tsx` unless a failing behavior test proves a defect. Wrap the existing timeline in glass panels and add semantic status classes using real task status.

- [ ] **Step 5: Run EXECUTION gate and commit**

```powershell
npm test --workspace web -- src/features/tasks src/features/gantt
npm run lint --workspace web
npm run build --workspace web
git diff --check
git add web/src/features/tasks web/src/features/gantt
git commit -m "feat: refactor task and gantt workspaces"
```

### Task 5: Refactor Requirements, Defects, and Settings

**Owner:** QUALITY thread

**Depends on:** Task 2

**Files:**
- Modify/Create only under `web/src/features/requirements/**`
- Modify/Create only under `web/src/features/defects/**`
- Modify/Create only under `web/src/features/settings/**`

Expected new files:
- `web/src/features/requirements/requirements-glass.css`
- `web/src/features/defects/DefectMatrix.tsx`
- `web/src/features/defects/defects-glass.css`
- `web/src/features/settings/SettingsCategoryNav.tsx`
- `web/src/features/settings/settings-glass.css`

- [ ] **Step 1: Write failing five-stage requirement pipeline tests**

Project real states into five visible lifecycle groups:

```ts
const visibleStages = ['draft', 'reviewed', 'developing', 'delivered', 'accepted'] as const
```

Keep rejected/shelved filtering, DnD announcements, keyboard coordinates, pending lock, Inspector, and versioned mutation. Only the existing allowed transitions are draggable.

- [ ] **Step 2: Implement requirement signature and local responsive scroll**

Each column is a named region. Linked task/defect information comes from existing hooks. Unsupported owner/change-risk fields are not invented.

- [ ] **Step 3: Write failing severity × status matrix tests**

`DefectMatrix` uses real `severity` and `status`. Selecting a matrix item updates the existing Inspector; the triage queue and defect-to-task action remain. Fatal/serious use critical treatment; normal uses warning/neutral; suggestion is silver/neutral.

- [ ] **Step 4: Write failing Settings category tests**

The category navigation exposes Appearance, General/Data, MCP, and Skills without duplicating forms. Switching category preserves actual component mutations and persistence. The existing real runtime settings tests must remain valid.

- [ ] **Step 5: Implement and run QUALITY gate**

```powershell
npm test --workspace web -- src/features/requirements src/features/defects src/features/settings
npm run lint --workspace web
npm run build --workspace web
git diff --check
git add web/src/features/requirements web/src/features/defects web/src/features/settings
git commit -m "feat: refactor quality and settings pages"
```

### Task 6: Integrate routing, responsive behavior, accessibility, and visuals

**Owner:** INTEGRATION thread; runs only after Tasks 1–5 are committed

**Files:**
- Modify: `web/src/app/router.test.tsx`
- Modify: `web/e2e/accessibility.spec.ts`
- Modify: `web/e2e/responsive-keyboard.spec.ts`
- Modify: `web/e2e/key-pages.spec.ts`
- Modify: `web/e2e/projects-actors-settings.spec.ts`
- Modify visual snapshots only after behavior checks pass
- Modify shared CSS only for an observed cross-page defect

- [ ] **Step 1: Add the nine-route smoke table**

```ts
const routeCases = [
  ['/dashboard', '全局驾驶舱'],
  ['/projects', '项目矩阵'],
  ['/projects/atlas', 'Atlas 研发平台'],
  ['/actors', '协作者网络'],
  ['/tasks', '任务控制台'],
  ['/gantt', '甘特排程'],
  ['/requirements', '需求管线'],
  ['/defects', '缺陷矩阵'],
  ['/settings', '设置中心'],
] as const
```

For each route assert one active nav link, visible H1/signature, no console error, skip-link/focus behavior, and Back/Forward consistency.

- [ ] **Step 2: Expand responsive and axe coverage**

Cover all nine pages at desktop and compact, and representative complex pages at 390/600/1280/1440. Assert document overflow is zero while local scroll containers remain reachable. Add `/projects/:id` to axe coverage.

- [ ] **Step 3: Add real-runtime project selection and current-actor journey**

Create two projects, navigate through the selector, refresh, and confirm the route parameter selects the correct project. Verify `/actors/current` matches the configured local actor and task/actor context uses that identity without a client-supplied actor ID.

- [ ] **Step 4: Investigate the pre-existing Dashboard snapshot mismatch**

Before updating images, capture the old application and compare the expected 1338px baseline with the current 1815px render. Record whether the delta comes from stale snapshots, fonts, or a genuine layout regression. Only then update snapshots for the approved new design and inspect every changed image.

- [ ] **Step 5: Run full gates**

```powershell
npm run check
npm run test:e2e --workspace web -- --project=desktop --project=compact
npm run test:e2e --workspace web -- --project=real-browser-journeys
npm run test:e2e
git diff --check
git status --short
```

Expected: lint, unit tests, typecheck/build, docs, fixture E2E, real runtime E2E, accessibility, responsive checks, and visual snapshots all pass. Temporary SQLite databases, servers, and browsers are stopped.

- [ ] **Step 6: Commit integration evidence**

```powershell
git add web/src/app/router.test.tsx web/e2e
git commit -m "test: validate glass frontend refactor"
```

## Plan self-review

- Spec coverage: all nine approved pages, shared shell, project-detail selector, real data, responsive, reduced motion, a11y, persistence, current actor, and final visual verification map to Tasks 1–6.
- Placeholder scan: no TBD/TODO/similar-to-later steps remain.
- Type consistency: `ProjectRepository.getCurrentActor(): Promise<Actor>` maps to `useCurrentActor()` and `/api/v1/actors/current`; project selection remains `/projects/:id`; no new domain entity types are introduced.
- Conflict check: Wave 1 and Wave 2 owners have disjoint files; only INTEGRATION may touch E2E, route tests, shared CSS fixes, or snapshots after page commits.
- TDD check: every production behavior begins with an explicit failing test and focused RED command.

