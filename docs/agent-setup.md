# Agent 接入指南

Project OS MCP 当前提供 27 tools，覆盖身份、项目、任务、需求、缺陷、进度、
仪表盘、活动和 Agent 接力会话。所有写操作都进入与 REST 相同的服务层、
SQLite 事务和活动日志。

## 前置条件

从仓库根目录执行：

```bash
npm ci
npm run build
```

确认以下文件存在：

- `apps/mcp/dist/stdio.js`
- `integrations/project-os/SKILL.md`
- `integrations/project-os/scripts/verify-connection.mjs`

默认 stdio 数据库是 `data/project_manage.db`。如果 REST 和 Agent 必须操作同一
数据，请让 `PROJECT_OS_DB` 与 API 的 `PROJECT_OS_DATABASE_PATH` 指向同一文件。

## stdio：Codex

把以下内容加入 Codex MCP 配置；仓库不在示例位置时替换绝对路径：

```toml
[mcp_servers.project-os]
command = "node"
args = ["E:/project_manage/apps/mcp/dist/stdio.js"]
env = { PROJECT_OS_DB = "E:/project_manage/data/project_manage.db" }
```

重启 Codex 任务后检查 `project-os` 工具。仓库内的规范参考为
[Codex 配置](../integrations/project-os/references/codex-config.md)。

## stdio：Claude Code

PowerShell：

```powershell
claude mcp add --transport stdio --env PROJECT_OS_DB=E:/project_manage/data/project_manage.db project-os -- node E:/project_manage/apps/mcp/dist/stdio.js
claude mcp list
```

重启会话使新配置生效。详见
[Claude Code 配置](../integrations/project-os/references/claude-code-config.md)。

## stdio：Kimi Code

在使用 Project OS 的客户端项目中创建 `.kimi-code/mcp.json`：

```json
{
  "mcpServers": {
    "project-os": {
      "command": "node",
      "args": ["E:/project_manage/apps/mcp/dist/stdio.js"],
      "env": {
        "PROJECT_OS_DB": "E:/project_manage/data/project_manage.db"
      }
    }
  }
}
```

保存后重启 Kimi Code。详见
[Kimi Code 配置](../integrations/project-os/references/kimi-code-config.md)。

## Streamable HTTP

启动服务：

```bash
npm start
```

本机端点为 `http://127.0.0.1:4310/mcp`。客户端传输类型应选择
Streamable HTTP。回环地址不强制认证，但仍建议只给受信任本机进程访问。

非回环监听之前：

1. 先在回环模式从设置页签发命名令牌并立即安全保存；明文只显示一次。
2. 设置 `PROJECT_OS_HOST`、`PROJECT_OS_ALLOWED_HOSTS` 和需要的
   `PROJECT_OS_ALLOWED_ORIGINS`。
3. 在客户端中通过安全的秘密存储注入 `Authorization: Bearer <redacted>`。
4. 使用 TLS 反向代理，不要直接把 Node 监听端口暴露到互联网。

例如仅说明变量形态（按实际域名替换）：

```powershell
$env:PROJECT_OS_HOST='0.0.0.0'
$env:PROJECT_OS_PORT='4310'
$env:PROJECT_OS_ALLOWED_HOSTS='project-os.internal.example'
$env:PROJECT_OS_ALLOWED_ORIGINS='https://project-os.internal.example'
npm start
```

非回环模式下 `/api/v1/health` 仍可匿名检查；其他 REST 与 MCP 请求需要有效
令牌。撤销令牌会使后续请求立即失效。

## 安装 Agent Skill

有两种等价来源：

- Web 设置 → **Agent Skills** → **下载 Project OS Skill**；
- 本机 API：`GET /api/v1/skills/project-os.zip`。

解压后应得到顶层 `project-os/`，其中包含 `SKILL.md`、`agents/`、
`references/` 和 `scripts/verify-connection.mjs`。把整个 `project-os/`
放入客户端支持的 Skill 目录，保持目录结构不变，然后重启客户端。各客户端的
Skill 发现目录可能随安装方式变化，应以该客户端当前文档或设置页为准。

ZIP 中的路径和配置片段会指向生成 ZIP 的 Project OS 运行目录，不包含令牌。
如果移动了仓库，重新下载 Skill 或更新绝对路径。

## 验证连接与副作用

默认验证只启动 stdio、完成协议初始化，并严格核对 27 tools；它不会调用需要
Agent 身份的业务 tools，因此不会写入 Agent、项目、任务或活动：

```bash
node integrations/project-os/scripts/verify-connection.mjs
```

预期 JSON 包含 `ok: true`、`mode: "contract-only"`、
`transport: "stdio"` 和 `toolCount: 27`。

这里的 `sideEffects: []` 只表示没有业务 tool 副作用，不代表文件系统只读。
stdio 启动会打开所选 SQLite；路径不存在时会创建父目录、数据库和 WAL，并执行
待应用的 schema migrations。需要保护现有数据库或验证 fresh clone 时，应显式
使用临时路径：

```bash
node integrations/project-os/scripts/verify-connection.mjs --database data/verify-temp.db
```

该命令仍会创建/迁移临时数据库；验证后只可删除已确认的临时目标。

写入验证必须显式启用：

```bash
node integrations/project-os/scripts/verify-connection.mjs --write-smoke
```

该模式会注册或恢复专用 smoke Agent，并更新其最后活动时间。提供已有 ID 时
仍会更新活动时间：

```bash
node integrations/project-os/scripts/verify-connection.mjs --write-smoke --agent-id actor_example
```

三客户端真实 smoke 会调用模型客户端并产生写入：

```bash
node scripts/smoke-clients.mjs --clients codex,claude,kimi --write-smoke
```

它为每个客户端创建隔离临时数据库，注册 smoke Agent、读取项目、提交进度并
核对活动，然后写入忽略版本控制的 `artifacts/mcp-smoke/*.json`。任一字段为
`false` 时命令应返回非零；不能把“已安装”视为“已验收”。

无模型调用的 harness 自检：

```bash
node scripts/smoke-clients.mjs --self-test
```

## Agent 三幕接力工作流

每个 Agent 会话都执行以下三幕。任务受阻或没有代码改动也不能省略结束动作。

### 第一幕：Start every session

1. 用已保存的 Agent ID 调用 `agent_whoami`。只有在 ID 不存在时才调用一次
   `agent_register` 并保存返回值；身份停用或失效时不得静默创建第二个身份。
2. 用明确的 `project_id`、`intent` 和本轮声明认领的 `task_ids` 调用
   `session_checkin`。认领只声明会话范围，不会改变任务状态或负责人。
3. 开工前读取 check-in 返回的 briefing：先看 `latest_handoff`，再看
   `new_activities`，然后核对当前任务、活动会话、近期交付物和受阻项。

### 第二幕：Perform work safely

1. 更新前读取当前 `version`；发生冲突时重新读取、协调并仅在意图仍然成立时
   重试。
2. 遵守角色权限、项目成员关系、任务分配和会话所有权；不能通过更换身份绕过
   拒绝。
3. 关键决策、踩坑和阻塞出现时立即调用 `session_note`；关联具体任务时带上
   `task_id`，不要等到结束时才补记。
4. 工具返回 `isError: true` 时不得声明成功。需要审计证据时用
   `activity_log` 核对；增量读取用 `since`，常规向后翻页用 `after`，两者
   不能同时提供。

### 第三幕：End every session（强制）

1. 先用 `deliverable_record` 登记每一个 commit、文件、URL 或说明，至少关联
   一个 `requirement_id` 或 `task_id`，并在适用时带上本轮 `session_id`。
2. 再用 `session_checkout` 写入 `summary`、`done`、`blockers` 和
   `next_steps`，并按需补充 `gotchas` 与结构化 `refs`。

没有 checkout 就不算完成；下一个 Agent 只能看到 abandoned 会话，收不到可
直接续作的结构化 handoff。

完整工具语义见
[工具参考](../integrations/project-os/references/tool-reference.md)。

## 排障

- **入口不存在**：先运行 `npm run build`，确认
  `apps/mcp/dist/stdio.js` 存在。
- **客户端看不到工具**：使用绝对路径，重启客户端，并运行默认连接验证。
- **Web 与 Agent 数据不同**：检查 `PROJECT_OS_DB` 与
  `PROJECT_OS_DATABASE_PATH` 是否解析到同一 SQLite 文件。
- **身份不存在或已停用**：不要静默注册第二个身份；在负责人目录核对状态。
- **版本冲突**：重新读取实体并使用最新 `version`，不要盲目重复写入。
- **HTTP 401**：检查令牌是否已撤销、是否遗漏 Bearer 头；令牌明文无法重新
  查看，只能签发新令牌。
- **远程启动配置错误**：非回环 `PROJECT_OS_HOST` 必须配
  `PROJECT_OS_ALLOWED_HOSTS`；Origin 值必须是完整且精确的 HTTP/HTTPS
  Origin。
- **客户端 smoke 超时或未认证**：先在对应 CLI 中完成登录，再用单客户端参数
  重试；证据必须保留失败字段。
