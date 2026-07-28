# Project Manage — 本地项目管理数据作战室

[中文](README.md) | [English](README_EN.md)

一个面向个人开发者、小型团队和 AI Agent 的本地项目管理前端原型。项目采用“数据作战室”视觉方向，把项目健康度、任务、甘特图、需求、缺陷和 Agent 活动集中在同一套高密度界面中。

> [!IMPORTANT]
> 当前版本是可运行的前端原型，不是生产级项目管理服务。数据由浏览器内的内存 Mock Repository 提供，刷新页面会恢复初始演示数据；项目暂未提供后端、数据库、登录、权限控制或多人实时协作。请勿录入真实敏感数据，也不要直接暴露到生产网络。

![数据作战室仪表盘](web/e2e/dashboard.spec.ts-snapshots/dashboard-90-day-desktop-win32.png)

## 功能概览

- 数据作战室仪表盘：项目健康度、交付趋势、状态分布、风险队列和活动流。
- 任务工作台：状态、负责人、优先级筛选，任务详情检查器和进度更新。
- 甘特图：任务树、时间轴、今日线、里程碑和依赖关系。
- 需求生命周期：评审、开发、交付三列看板，支持拖拽和键盘可访问的状态更新。
- 缺陷风险队列：按严重度和状态查看缺陷，并将缺陷转换为修复任务。
- 数据状态：加载、空数据、错误、刷新失败和陈旧数据提示。
- 响应式与无障碍：覆盖 1440、1280、1024 和 768 宽度，包含键盘操作与自动化 WCAG A/AA 检查。
- 大数据验证：开发模式可启用 10,000 条确定性任务，任务表和甘特图使用虚拟化渲染。

![项目甘特图](web/e2e/key-pages.spec.ts-snapshots/gantt-desktop-win32.png)

## 技术栈

- React 19、TypeScript 6、Vite 8
- React Router
- TanStack Query、TanStack Table、TanStack Virtual
- ECharts
- dnd-kit
- Vitest、Testing Library、Playwright、axe-core

## 环境要求

- Node.js 20.19 或更高版本
- npm
- Git

建议使用当前 Node.js LTS 版本。仓库已提交 `web/package-lock.json`，安装依赖时优先使用 `npm ci`。

## 安装与启动

### 1. 克隆仓库

使用 SSH：

```bash
git clone git@github.com:wozoulesky/project_manage.git
cd project_manage/web
```

也可以使用 HTTPS：

```bash
git clone https://github.com/wozoulesky/project_manage.git
cd project_manage/web
```

### 2. 安装依赖

```bash
npm ci
```

### 3. 启动开发服务器

```bash
npm run dev
```

Vite 默认会提供 `http://localhost:5173`；如果端口已被占用，请以终端实际输出的地址为准。

## 页面入口

| 路径 | 页面 |
|---|---|
| `/dashboard` | 仪表盘 |
| `/tasks` | 任务工作台 |
| `/gantt` | 甘特图 |
| `/requirements` | 需求生命周期 |
| `/defects` | 缺陷风险队列 |
| `/settings` | 设置占位页 |

访问根路径 `/` 会自动跳转到仪表盘。未知路径会显示带返回入口的 404 页面。

## 常用命令

以下命令均在 `web/` 目录运行。

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 执行 TypeScript 检查并生成生产构建 |
| `npm run preview` | 本地预览 `dist/` 构建结果 |
| `npm run lint` | 执行 ESLint |
| `npm run test` | 执行一次 Vitest 测试 |
| `npm run test:watch` | 以监听模式运行 Vitest |
| `npm run test:e2e` | 执行 Playwright 端到端与视觉回归测试 |
| `npm run check` | 依次执行 lint、单元测试和生产构建 |

## 端到端与视觉测试

首次运行前安装项目所需的 Chromium：

```bash
npx playwright install chromium
```

然后运行：

```bash
npm run test:e2e
```

Playwright 会自动构建并在 `http://127.0.0.1:4173` 启动预览服务。测试包含桌面和紧凑布局、键盘操作、无障碍扫描、业务闭环以及视觉基线。

视觉基线是在 Windows Chromium 环境生成的，文件名带有 `win32` 后缀。不同操作系统、字体或浏览器渲染环境可能产生像素差异；请先人工检查差异，再决定是否更新基线：

```bash
npm run test:e2e -- --update-snapshots
```

不要在未检查截图的情况下批量接受视觉基线变化。

## 10,000 任务验证模式

该模式仅在开发服务器中生效，不会进入普通生产构建。

PowerShell：

```powershell
$env:VITE_FIXTURE_MODE='large'
npm run dev
```

Bash、zsh：

```bash
VITE_FIXTURE_MODE=large npm run dev
```

关闭服务器并清除该环境变量后，即可恢复默认演示数据。

## 构建与静态部署

```bash
cd web
npm ci
npm run build
```

构建产物位于 `web/dist/`。这是一个使用 `BrowserRouter` 的单页应用，部署到 Nginx、Apache、对象存储或静态托管服务时，必须把未知前端路由回退到 `index.html`，否则直接刷新 `/tasks`、`/gantt` 等页面会返回服务器 404。

仓库目前没有绑定特定云平台，也没有自动部署配置。

## 数据与功能边界

- 所有项目数据均来自 `web/src/data/` 下的确定性演示数据和内存仓库。
- 页面内的任务进度、需求状态和缺陷转换可以在当前 SPA 会话中联动，但刷新或重新打开页面后会重置。
- 当前没有 SQLite、REST API、文件同步、云同步或持久化存储。
- 当前没有用户账户、身份验证、授权、审计后端或租户隔离。
- 页面中出现的人名、Agent、任务、需求和缺陷均为演示数据。
- 设置页面目前只是占位页。

如果要用于真实团队，至少需要新增持久化后端、数据迁移、身份认证、授权模型、输入校验、审计日志、备份恢复和安全部署策略。

## 安全与依赖注意事项

- 不要在源码、环境文件、截图、Issue 或测试数据中提交令牌、密码、SSH 私钥或真实业务数据。
- `VITE_*` 变量会被打包到前端，不能用于保存秘密。
- E2E 错误夹具只在测试构建中启用，普通生产构建会将其移除。
- 项目当前仅使用 React Router 的客户端 SPA 能力，不使用 unstable RSC API。
- `react-router-dom` 当前锁定为 `7.18.1`。截至 2026-07-28，`npm audit` 会报告 [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) 高危公告；公告说明只有使用 unstable RSC API 的应用会受影响，本项目当前不使用该调用路径。修复版本为 React Router `8.3.0`，属于需要单独评估和测试的主版本升级。
- 不要直接运行 `npm audit fix --force`：当前 npm 建议会改变 `react-router-dom` 版本，可能引入不兼容变更。应先创建独立升级分支，再完整执行回归测试。
- 依赖升级前后都应重新执行 `npm run check` 和 `npm run test:e2e`。
- 发布前建议执行 `npm audit`，并结合项目实际调用范围人工判断公告影响，不要只依赖自动修复。

## 项目结构

```text
project_manage/
├── README.md
├── README_EN.md
├── PRD.md
├── docs/
│   └── superpowers/
│       ├── plans/
│       └── specs/
└── web/
    ├── e2e/
    ├── public/
    ├── src/
    │   ├── app/
    │   ├── components/
    │   ├── data/
    │   ├── features/
    │   └── styles/
    ├── package.json
    └── playwright.config.ts
```

## 设计与实现文档

- [产品需求文档](PRD.md)
- [视觉与交互设计规格](docs/superpowers/specs/2026-07-28-project-management-ui-design.md)
- [前端实现计划](docs/superpowers/plans/2026-07-28-project-management-web-ui.md)

## 贡献

欢迎通过 Issue 报告可复现的问题，也欢迎提交范围清晰、包含验证说明的 Pull Request。提交代码前请至少运行：

```bash
cd web
npm run check
npm run test:e2e
```

## 许可证

当前仓库尚未包含开源许可证。公开可见不代表自动授予复制、修改或分发权。仓库所有者确定授权方式后，应在根目录添加明确的 `LICENSE` 文件。
