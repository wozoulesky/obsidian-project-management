# Task Console Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained 1440px desktop HTML prototype that applies the approved cinematic glass-console visual direction to the Project OS task-management page.

**Architecture:** Keep the deliverable in one offline HTML file containing semantic markup, CSS, embedded task data, and dependency-free JavaScript. Isolate it under `docs/prototypes` so it neither imports nor modifies the active React application; validate its structure with Node and its behavior and appearance with Playwright.

**Tech Stack:** HTML5, CSS custom properties and 3D transforms, vanilla JavaScript, Node.js assertions, Playwright Chromium.

---

## File Structure

- Create `docs/prototypes/project-os-task-console.html`: complete visual prototype, embedded styles, demo data, and interactions.
- Create `docs/prototypes/project-os-task-console.png`: 1440×900 review screenshot produced from the HTML after browser validation.
- Do not modify files under `web/src` or existing prototypes.

### Task 1: Build the offline page shell and visual system

**Files:**
- Create: `docs/prototypes/project-os-task-console.html`

- [ ] **Step 1: Run a preflight assertion and verify the deliverable is absent**

```powershell
node -e "const fs=require('fs'); if(!fs.existsSync('docs/prototypes/project-os-task-console.html')) throw new Error('prototype missing')"
```

Expected: command fails with `Error: prototype missing`.

- [ ] **Step 2: Create the semantic three-column shell**

Use one UTF-8 document with these top-level landmarks and stable selectors:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Project OS · 任务管理视觉原型</title>
  </head>
  <body>
    <div class="ambient" aria-hidden="true"></div>
    <div class="console-shell">
      <aside class="side-rail" aria-label="主导航"></aside>
      <main class="workspace" id="main-content"></main>
      <aside class="smart-panel" aria-label="智能详情"></aside>
    </div>
    <div class="toast" role="status" aria-live="polite"></div>
  </body>
</html>
```

Populate the side rail with Project OS branding and the existing navigation labels: 仪表盘、项目、负责人、计划 / 任务、甘特图、需求、缺陷、设置. Populate the workspace with a top utility row, four metric cards, a task-board region, a 3D task-fan region, and a bottom timeline. Populate the smart panel with the selected-task details and action buttons.

- [ ] **Step 3: Add the approved visual tokens and component styles**

Define and use these base tokens; keep all values local to the document:

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

Implement a 220px left rail, elastic central workspace, and 300px right panel at 1440px. Use layered gradients, subtle grid texture, one-pixel silver borders, inset highlights, backdrop blur, and restrained green bloom. Make the selected 3D card bright green while keeping the remaining cards silver-gray. Include `:focus-visible` styles and a `@media (prefers-reduced-motion: reduce)` block that disables transforms and animation.

- [ ] **Step 4: Verify the shell and visual contract**

```powershell
node -e "const fs=require('fs'); const s=fs.readFileSync('docs/prototypes/project-os-task-console.html','utf8'); for(const x of ['lang=\"zh-CN\"','class=\"side-rail\"','class=\"workspace\"','class=\"smart-panel\"','--green: #37f58a','prefers-reduced-motion']) if(!s.includes(x)) throw new Error('missing '+x); console.log('shell contract ok')"
```

Expected: `shell contract ok`.

- [ ] **Step 5: Commit the visual shell**

```powershell
git add docs/prototypes/project-os-task-console.html
git commit -m "feat: add cinematic task console prototype"
```

Expected: one commit containing only the new prototype HTML.

### Task 2: Add realistic task content and local interactions

**Files:**
- Modify: `docs/prototypes/project-os-task-console.html`

- [ ] **Step 1: Add embedded demo task data**

Define at least six task records in the script using this complete schema:

```js
const tasks = [
  {
    id: 'task-001',
    code: 'POS-2026-081',
    title: '统一任务工作台视觉规范',
    description: '完成任务中心的信息层级、状态语言与组件验收。',
    owner: 'Lin',
    project: 'Project OS v1.2',
    due: '2026-08-06 18:00',
    status: '进行中',
    priority: '高',
    progress: 72,
    scope: ['all', 'mine'],
    tags: ['设计系统', '关键路径'],
  },
]
```

Add further records for MCP 接入验收、备份恢复演练、移动端布局验证、需求评审闭环 and 发布检查清单 so each scope and status has visible data.

- [ ] **Step 2: Render task rows, fan cards, metrics, and details from one data source**

Use the following functions and responsibilities:

```js
function visibleTasks() { return tasks.filter((task) => activeScope === 'all' || task.scope.includes(activeScope)) }
function selectedTask() { return tasks.find((task) => task.id === selectedId) || visibleTasks()[0] }
function renderMetrics() { /* derive counts from tasks and update metric values */ }
function renderTaskList() { /* render accessible buttons for visibleTasks() */ }
function renderFan() { /* render the same visible tasks as layered glass cards */ }
function renderDetails() { /* update title, facts, tags, progress and advice */ }
function renderAll() { renderMetrics(); renderTaskList(); renderFan(); renderDetails() }
```

Task buttons must carry `data-task-id`, `aria-pressed`, and visible code, title, status, time, and progress. Fan cards must use `--index` and `--count` custom properties so CSS controls perspective without inline geometry duplication.

- [ ] **Step 3: Add scoped interactions and feedback**

Wire these behaviors:

```js
document.addEventListener('click', (event) => {
  const task = event.target.closest('[data-task-id]')
  if (task) {
    selectedId = task.dataset.taskId
    renderAll()
  }
  const scope = event.target.closest('[data-scope]')
  if (scope) {
    activeScope = scope.dataset.scope
    selectedId = visibleTasks()[0]?.id || null
    renderAll()
  }
})
```

Add time-range switching through `data-range`, a pointer-driven `--tilt-x`/`--tilt-y` update on the fan stage, and `showToast(message)` feedback for 新增任务、编辑任务 and 完成任务. Completing a task should update only the in-memory selected record to `status: '已完成'` and `progress: 100`.

- [ ] **Step 4: Verify content and interaction hooks**

```powershell
node -e "const fs=require('fs'); const s=fs.readFileSync('docs/prototypes/project-os-task-console.html','utf8'); for(const x of ['POS-2026-081','data-task-id','data-scope','data-range','function renderAll','function showToast','aria-live=\"polite\"']) if(!s.includes(x)) throw new Error('missing '+x); console.log('interaction contract ok')"
```

Expected: `interaction contract ok`.

- [ ] **Step 5: Commit the interactions**

```powershell
git add docs/prototypes/project-os-task-console.html
git commit -m "feat: add task console prototype interactions"
```

Expected: one commit containing only the HTML interaction update.

### Task 3: Validate in Chromium and capture the review image

**Files:**
- Modify: `docs/prototypes/project-os-task-console.html` only if browser validation finds a defect.
- Create: `docs/prototypes/project-os-task-console.png`

- [ ] **Step 1: Start a local static server**

```powershell
python -m http.server 4175 --directory docs/prototypes
```

Expected: server listens on `http://127.0.0.1:4175` and serves the prototype.

- [ ] **Step 2: Run a focused Playwright behavior check**

Open `http://127.0.0.1:4175/project-os-task-console.html` with a 1440×900 viewport and assert:

```js
await expect(page.locator('.console-shell')).toBeVisible()
await expect(page.locator('.task-list [data-task-id]')).toHaveCount(6)
await page.locator('[data-task-id="task-002"]').first().click()
await expect(page.locator('[data-detail-title]')).toContainText('MCP')
await page.locator('[data-scope="mine"]').click()
await expect(page.locator('[data-scope="mine"]')).toHaveAttribute('aria-pressed', 'true')
await page.locator('[data-action="complete"]').click()
await expect(page.locator('[data-detail-status]')).toHaveText('已完成')
```

Expected: every assertion passes and no page errors are emitted.

- [ ] **Step 3: Inspect the 1440×900 screenshot**

Capture the full viewport to `docs/prototypes/project-os-task-console.png`. Confirm that the rail, four metrics, task list, 3D fan, smart panel, and timeline are all visible; text does not overlap; the selected green card is the dominant focal point; silver cards remain legible; and the lower timeline is not pushed entirely below the fold.

- [ ] **Step 4: Fix only observed defects and rerun the checks**

If validation finds a defect, adjust the smallest relevant CSS rule or interaction function in `docs/prototypes/project-os-task-console.html`, rerun Step 2, and recapture the screenshot. Do not change the approved layout or add new features.

- [ ] **Step 5: Commit the validated preview**

```powershell
git add docs/prototypes/project-os-task-console.html docs/prototypes/project-os-task-console.png
git commit -m "test: validate task console prototype preview"
```

Expected: final commit contains the review screenshot and only any validation-driven HTML corrections.
