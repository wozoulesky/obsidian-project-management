# Project OS Web

[中文主文档](../README.md) | [English](../README_EN.md)

React 19、TypeScript、Vite 构建的 Project OS Web 客户端。普通构建使用真实
REST Repository；Mock Repository 只在单元测试和显式 E2E fixture 模式中启用。

## 开发

从仓库根目录安装并启动完整环境：

```bash
npm ci
npm run dev
```

Web 通常运行在 `http://localhost:5173`，`/api` 被代理到
`http://127.0.0.1:4310`。不要只启动 Web 后期待真实数据可用。

主要路由包括 `/projects`、`/projects/:id`、`/actors`、`/dashboard`、
`/tasks`、`/gantt`、`/requirements`、`/defects` 和 `/settings`。

## 构建

```bash
npm run build
```

Web 产物位于 `web/dist/`。生产静态服务器必须：

- 将未知前端路由回退到 `index.html`；
- 把 `/api` 反向代理到 Project OS API；
- 保留 API 返回的安全响应头；
- 跨来源部署时，让 API 的 `PROJECT_OS_ALLOWED_ORIGINS` 包含 Web 的精确
  Origin。

根目录 `npm start` 只启动 API/MCP，不托管 Web 产物。

## 测试

```bash
npx playwright install chromium
npm test
npm run test:e2e
```

Playwright 使用隔离的临时 SQLite 数据库和独立服务端口，覆盖真实项目、负责人、
快速提交、设置、错误恢复、键盘、无障碍与视觉基线。截图基线为 Windows
Chromium；更新快照前必须人工检查差异。

完整门禁：

```bash
npm run check
```

## 运行时约定

- API 前缀为 `/api/v1`；MCP Streamable HTTP 为 `/mcp`。
- 外观会立即写入根元素属性和本地存储，再与 `/api/v1/settings` 协调。
- 活动游标在页面可见时轮询，用于使 MCP/REST 写入后的查询失效。
- 导入上限为 25 MiB、字段名为 `file`、媒体类型为 `application/json`。
- 访问令牌明文只在创建响应中出现一次，不写入浏览器持久存储。

Agent 配置见 [Agent 接入指南](../docs/agent-setup.md)，数据操作见
[数据与备份指南](../docs/data-and-backups.md)。
