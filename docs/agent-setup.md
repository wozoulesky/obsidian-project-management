# Agent 接入指南

Project OS MCP 当前提供 22 tools，覆盖身份、项目、任务、需求、缺陷、进度、
仪表盘和活动。所有写操作都进入与 REST 相同的服务层、SQLite 事务和活动日志。

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

默认验证只启动 stdio、完成协议初始化，并严格核对 22 tools；它不会调用需要
Agent 身份的工具：

```bash
node integrations/project-os/scripts/verify-connection.mjs
```

预期 JSON 包含 `ok: true`、`mode: "contract-only"`、
`transport: "stdio"` 和 `toolCount: 22`。

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

## Agent 身份与安全工作流

1. 首次使用 `agent_register`，保存返回的 Agent ID；后续先调用
   `agent_whoami`，不要重复注册。
2. 用 `project_list` 和带 `assignee_id` 的 `task_list` 建立工作范围。
3. 更新前读取当前 `version`；冲突时重新读取并人工协调。
4. 用 `progress_submit` 提交被分配任务的进度，并用 `activity_log` 核对审计
   记录。
5. 工具返回 `isError: true` 时不得声明成功，也不得通过更换身份绕过权限。

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
