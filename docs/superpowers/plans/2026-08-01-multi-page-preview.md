# Project OS Multi-Page Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one offline HTML prototype that lets the user click through all nine Project OS pages while preserving one coherent black-silver-glass visual system and a distinct business-appropriate signature area on each page.

**Architecture:** Create a new self-contained document rather than modifying the validated task-console prototype. The file owns a shared shell, design tokens, embedded demo data, route-local state, DOM renderers, and dependency-free interactions; URL hashes provide navigation and browser history without a server or framework.

**Tech Stack:** HTML5, CSS custom properties and Grid, vanilla JavaScript DOM APIs, URL hash routing, Node.js contract assertions, Playwright with installed Chrome, axe-core from the existing web workspace.

---

## File Structure

- Create `docs/prototypes/project-os-multipage-preview.html`: shared shell, nine page renderers, embedded data, styles, and interactions.
- Create `docs/prototypes/project-os-multipage-preview.png`: representative 1440×900 dashboard screenshot for review.
- Read-only reference `docs/prototypes/project-os-task-console.html`: approved visual tokens, task data semantics, accessibility patterns, and task-page signature.
- Do not modify `docs/prototypes/project-os-task-console.html`, `docs/prototypes/project-os-task-console.png`, or files under `web/src`.

### Task 1: Create the shared shell, visual tokens, and hash router

**Files:**
- Create: `docs/prototypes/project-os-multipage-preview.html`

- [ ] **Step 1: Run the preflight contract and verify the file is absent**

```powershell
node -e "const fs=require('fs'); if(!fs.existsSync('docs/prototypes/project-os-multipage-preview.html')) throw new Error('multi-page preview missing')"
```

Expected: command fails with `Error: multi-page preview missing`.

- [ ] **Step 2: Create the self-contained document and fixed application shell**

Use this document outline and retain the exact hooks:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Project OS · 多页面视觉预览</title>
  </head>
  <body>
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <div class="ambient" aria-hidden="true"></div>
    <div class="app-shell">
      <aside class="side-rail" aria-label="主导航"></aside>
      <main class="page-main" id="main-content" tabindex="-1">
        <div data-page-root></div>
      </main>
    </div>
    <div class="toast" role="status" aria-live="polite"></div>
  </body>
</html>
```

Populate the rail with hash links for `dashboard`, `projects`, `project-detail`, `actors`, `tasks`, `gantt`, `requirements`, `defects`, and `settings`. Group labels are 概览、交付、质量、系统. Include the Project OS brand, Project OS Core workspace, and Local Owner card.

- [ ] **Step 3: Add the approved shared design tokens and component grammar**

Start with the exact validated core tokens:

```css
:root {
  color-scheme: dark;
  --bg: #030504;
  --surface: rgba(18, 22, 20, 0.74);
  --surface-raised: rgba(28, 33, 30, 0.82);
  --line: rgba(226, 240, 233, 0.16);
  --line-bright: rgba(245, 255, 250, 0.34);
  --text: #f3f7f4;
  --muted: #8d9791;
  --green: #37f58a;
  --green-deep: #10b965;
  --red: #ff5c61;
  --amber: #ffb45c;
  --radius-panel: 20px;
  --radius-card: 14px;
  --shadow: 0 24px 70px rgba(0, 0, 0, 0.52);
}
```

Implement shared classes `.page-header`, `.metric-grid`, `.metric-card`, `.glass-panel`, `.segmented`, `.status-badge`, `.context-panel`, `.primary-action`, `.empty-state`, and `.signature-stage`. At 1440px keep a 220px rail and elastic page body. Primary actions use dark glass with green edge-light, not solid green. Add visible focus, local scroll containers, responsive breakpoints, and reduced-motion rules.

- [ ] **Step 4: Add a dependency-free hash router**

Use this route contract and function names:

```js
const routeOrder = [
  'dashboard', 'projects', 'project-detail', 'actors', 'tasks',
  'gantt', 'requirements', 'defects', 'settings',
]

const pageTitles = {
  dashboard: '仪表盘',
  projects: '项目',
  'project-detail': '项目详情',
  actors: '负责人',
  tasks: '计划 / 任务',
  gantt: '甘特图',
  requirements: '需求',
  defects: '缺陷',
  settings: '设置',
}

const pageRoot = document.querySelector('[data-page-root]')

const pageRenderers = {
  dashboard: renderDashboard,
  projects: renderProjects,
  'project-detail': renderProjectDetail,
  actors: renderActors,
  tasks: renderTasks,
  gantt: renderGantt,
  requirements: renderRequirements,
  defects: renderDefects,
  settings: renderSettings,
}

function currentRoute() {
  const candidate = location.hash.replace(/^#\/?/, '')
  return routeOrder.includes(candidate) ? candidate : 'dashboard'
}

function renderCurrentPage({ focusHeading = false } = {}) {
  const route = currentRoute()
  document.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === route
    link.classList.toggle('is-active', active)
    active ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current')
  })
  pageRoot.replaceChildren(pageRenderers[route]())
  document.title = `Project OS · ${pageTitles[route]}`
  if (focusHeading) pageRoot.querySelector('h1')?.focus()
}

window.addEventListener('hashchange', () => renderCurrentPage({ focusHeading: true }))
if (!location.hash) history.replaceState(null, '', '#dashboard')
renderCurrentPage()
```

In Task 1, define every renderer as a semantic temporary shell returning a section with the correct `h1` so routing works before later tasks replace each body.

- [ ] **Step 5: Verify shell and routing contracts**

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('docs/prototypes/project-os-multipage-preview.html','utf8');for(const x of ['lang=\"zh-CN\"','data-page-root','data-route=\"dashboard\"','data-route=\"settings\"','const routeOrder','const pageRenderers','function renderCurrentPage','--green: #37f58a','prefers-reduced-motion'])if(!s.includes(x))throw new Error('missing '+x);console.log('multi-page shell contract ok')"
```

Expected: `multi-page shell contract ok`.

- [ ] **Step 6: Commit the shell**

```powershell
git add docs/prototypes/project-os-multipage-preview.html
git commit -m "feat: add multi-page preview shell"
```

### Task 2: Implement the overview pages

**Files:**
- Modify: `docs/prototypes/project-os-multipage-preview.html`

- [ ] **Step 1: Add shared demo data for overview pages**

Define these collections with stable identifiers:

```js
const projects = [
  { id: 'project-os', name: 'Project OS v1.2', owner: 'Lin', progress: 72, health: '正常', risk: 2, due: '2026-08-31' },
  { id: 'mcp-bridge', name: 'MCP 接入矩阵', owner: 'dev-agent', progress: 48, health: '关注', risk: 4, due: '2026-09-12' },
  { id: 'mobile-review', name: '移动端体验验收', owner: 'Chen', progress: 64, health: '正常', risk: 1, due: '2026-08-20' },
  { id: 'release-flow', name: '发布流程自动化', owner: 'qa-agent', progress: 36, health: '高风险', risk: 5, due: '2026-08-18' },
]

const actors = [
  { id: 'lin', name: 'Lin', type: 'human', status: '在线', load: 68, skills: ['产品', '架构'] },
  { id: 'chen', name: 'Chen', type: 'human', status: '专注', load: 54, skills: ['设计', '前端'] },
  { id: 'dev-agent', name: 'dev-agent', type: 'agent', status: '运行中', load: 76, skills: ['编码', '重构'] },
  { id: 'qa-agent', name: 'qa-agent', type: 'agent', status: '待命', load: 32, skills: ['测试', '验收'] },
]
```

Add deterministic health-trend, risk-queue, deliverable, and activity records used by the dashboard.

- [ ] **Step 2: Implement `renderDashboard()`**

Return a semantic page containing:

- shared header with title 仪表盘 and subtitle 项目健康、协作状态与交付风险；
- four derived metrics: 项目总数、进行中、待处理风险、活跃协作者;
- one health轨道 signature visualization;
- risk queue, actor presence, recent deliverables, and activity feed;
- a context summary updated by clicking a risk or actor.

Use `data-dashboard-select` on selectable items and `data-dashboard-context` on the detail area.

- [ ] **Step 3: Implement `renderProjects()`**

Return a glass portfolio matrix with filters `all`, `healthy`, `attention`, `risk` through `data-project-filter`. Project buttons carry `data-project-id` and update a selected-project summary without navigating. The signature area is the project matrix itself; no 3D fan is allowed.

- [ ] **Step 4: Implement `renderActors()`**

Return a restrained collaboration-network signature using positioned DOM nodes and CSS connecting lines. Actor buttons carry `data-actor-id`; selection updates workload, skills, projects, and recent activity. Provide filters for 全部、人类、Agent.

- [ ] **Step 5: Wire overview interactions through one delegated listener**

Maintain route-local state:

```js
const previewState = {
  dashboardSelection: 'risk-01',
  projectFilter: 'all',
  selectedProjectId: 'project-os',
  actorFilter: 'all',
  selectedActorId: 'lin',
}
```

The document-level click listener updates only the relevant state property and rerenders the current page; it must not register new listeners inside renderers.

- [ ] **Step 6: Verify overview page contracts and commit**

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('docs/prototypes/project-os-multipage-preview.html','utf8');for(const x of ['function renderDashboard','function renderProjects','function renderActors','data-dashboard-select','data-project-filter','data-project-id','data-actor-id','const previewState'])if(!s.includes(x))throw new Error('missing '+x);console.log('overview pages contract ok')"
git diff --check
git add docs/prototypes/project-os-multipage-preview.html
git commit -m "feat: add overview preview pages"
```

### Task 3: Implement the execution and quality pages

**Files:**
- Modify: `docs/prototypes/project-os-multipage-preview.html`

- [ ] **Step 1: Add shared execution records**

Define stable `tasks`, `requirements`, `defects`, `milestones`, `deliverables`, and `handoffs` arrays. Reuse the approved task `POS-2026-081` and its status/priority semantics from the task-console prototype. Each requirement references task IDs; each defect references a requirement or project ID.

- [ ] **Step 2: Implement `renderProjectDetail()`**

Return a phase-milestone track as the signature area, plus briefing, open tasks, deliverables, latest handoff, risks, and a contextual project facts panel. Milestone buttons use `data-milestone-id` and update the context without leaving the route.

- [ ] **Step 3: Implement `renderTasks()`**

Adapt the validated task-console grammar into the shared shell:

- four KPIs 今日待办、进行中、已完成、逾期;
- scrollable task list and scope filters;
- six-card 3D fan using `--index`/`--count` and one luminous selected card;
- smart task context and independent delivery timeline;
- task selection and memory-only complete feedback.

Use `data-task-id`, `data-task-scope`, `data-task-range`, `data-task-detail`, and `data-task-complete` hooks. Do not copy a second full app shell from the reference file.

- [ ] **Step 4: Implement `renderGantt()`**

Return a horizontally scrollable timeline with week/month/quarter controls, today marker, task bars and dependency connectors. Status semantics are fixed: 进行中 green, 逾期 red, 完成 silver. Task buttons use `data-gantt-task-id` and update a context inspector. Do not add 3D cards.

- [ ] **Step 5: Implement `renderRequirements()`**

Return a lifecycle pipeline with 收集、评审、已批准、开发中、已交付 columns. Requirement cards use `data-requirement-id`; selection updates acceptance criteria, owner, priority, linked tasks, linked defects, and change risk.

- [ ] **Step 6: Implement `renderDefects()`**

Return a severity/impact matrix and triage queue. Defect buttons use `data-defect-id`; selection updates reproduction steps, impact, owner, related version, and requirement. Red is reserved for blocker/critical states; medium states use amber.

- [ ] **Step 7: Wire execution interactions and verify contracts**

Extend `previewState` with `selectedMilestoneId`, `taskScope`, `selectedTaskId`, `taskRange`, `ganttRange`, `selectedGanttTaskId`, `selectedRequirementId`, and `selectedDefectId`. Update state through the same delegated listener and rerender the current page.

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('docs/prototypes/project-os-multipage-preview.html','utf8');for(const x of ['function renderProjectDetail','function renderTasks','function renderGantt','function renderRequirements','function renderDefects','data-milestone-id','data-task-id','data-gantt-task-id','data-requirement-id','data-defect-id'])if(!s.includes(x))throw new Error('missing '+x);console.log('execution pages contract ok')"
git diff --check
git add docs/prototypes/project-os-multipage-preview.html
git commit -m "feat: add execution preview pages"
```

### Task 4: Implement settings and cross-page interaction quality

**Files:**
- Modify: `docs/prototypes/project-os-multipage-preview.html`

- [ ] **Step 1: Implement `renderSettings()`**

Use a calm two-column configuration layout with categories 外观、数据、MCP、Skills. Controls are semantic inputs, selects, checkboxes, and buttons. Switching `data-settings-section` changes the visible form; save/test/export actions show honest prototype feedback without writing storage. No 3D, strong bloom, or decorative charts are allowed.

- [ ] **Step 2: Add shared toast and honest prototype actions**

Implement:

```js
const toast = document.querySelector('.toast')
let toastTimer = 0
function showToast(message) {
  clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add('is-visible')
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200)
}
```

Use `data-prototype-action` for 新建、保存、测试连接、导出 and similar buttons. Copy must say 已记录原型操作 or 预览模式，不 claim data was persisted.

- [ ] **Step 3: Preserve focus and browser-history behavior**

After hash navigation, focus the new `h1` with `tabindex="-1"`. After a state-only rerender, restore focus to the matching replacement control using its data hook and identifier. The first Tab from page load reaches the skip link; Escape closes any open compact-navigation state.

- [ ] **Step 4: Complete responsive and reduced-motion behavior**

Verify:

- 1440px: full rail, page body, optional context column, and signature area visible.
- 1280px: signature visual reduces spacing without clipping interactive text.
- 600px: rail becomes compact horizontal/local navigation and context moves below.
- 390px: no page-level horizontal overflow; Gantt, timeline, network, and card fan use local scrolling.
- reduced motion: fan transforms, parallax, continuous transitions, and network motion are disabled.

- [ ] **Step 5: Verify all nine routes and commit**

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('docs/prototypes/project-os-multipage-preview.html','utf8');for(const x of ['function renderSettings','data-settings-section','data-prototype-action','function showToast','role=\"status\"','aria-live=\"polite\"','prefers-reduced-motion'])if(!s.includes(x))throw new Error('missing '+x);console.log('settings and interaction contract ok')"
git diff --check
git add docs/prototypes/project-os-multipage-preview.html
git commit -m "feat: complete multi-page preview interactions"
```

### Task 5: Validate every page in Chromium and capture the preview

**Files:**
- Modify: `docs/prototypes/project-os-multipage-preview.html` only for observed defects.
- Create: `docs/prototypes/project-os-multipage-preview.png`

- [ ] **Step 1: Start a temporary local server**

```powershell
Start-Process -FilePath python -ArgumentList '-m','http.server','4176','--directory','docs/prototypes' -WindowStyle Hidden -PassThru
```

Expected: `http://127.0.0.1:4176/project-os-multipage-preview.html#dashboard` loads. Record the process ID and stop it after validation.

- [ ] **Step 2: Run route, history, and interaction checks**

At 1440×900, visit each hash in `routeOrder` and assert:

```js
for (const route of routeOrder) {
  await page.goto(`${baseUrl}#${route}`)
  await expect(page.locator(`[data-route="${route}"]`)).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-page-root] h1')).toBeVisible()
  await expect(page.locator('.signature-stage')).toBeVisible()
}
```

Then validate representative interactions on every page: dashboard context, project filter/selection, project milestone, actor selection, task filter/selection/completion, Gantt range/task selection, requirement selection, defect selection, and settings category/prototype feedback. Navigate with links, Back, and Forward; route and focus must follow history.

- [ ] **Step 3: Run visual, responsive, accessibility, and offline checks**

For each route at 1440 and representative routes at 1280, 600, and 390:

- no page/console errors;
- no unexpected external requests;
- no document horizontal overflow;
- one and only one active navigation link;
- page title and `h1` match;
- no critical/serious axe violations;
- signature visuals remain readable and interactive;
- reduced-motion transforms/animations are disabled.

- [ ] **Step 4: Capture and inspect the dashboard screenshot**

Reset to `#dashboard`, select the default risk, hide toast, reset local scroll positions, move pointer to a neutral area, wait 700ms, and capture exactly 1440×900 to `docs/prototypes/project-os-multipage-preview.png`. Inspect the image for a complete first fold, readable typography, restrained green, silver glass consistency, and no overlap.

- [ ] **Step 5: Fix only observed defects and rerun affected checks**

Adjust the smallest CSS rule, renderer, or state handler responsible for a reproduced problem. Do not add routes, persistent state, or new visual features.

- [ ] **Step 6: Run repository tests and commit validation artifacts**

```powershell
npm test
git diff --check
git add docs/prototypes/project-os-multipage-preview.html docs/prototypes/project-os-multipage-preview.png
git commit -m "test: validate multi-page preview"
```

Expected: all repository tests pass; commit contains only the multi-page HTML, PNG, and validation-driven corrections. Stop the temporary server and verify port 4176 is no longer listening.
