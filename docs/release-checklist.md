# 发布检查清单

本文件只记录实际执行的证据。修正后的隔离 harness 已完成重跑；Kimi Code
完整通过，Codex 和 Claude Code 仍未满足全部字段，因此本候选版本**不得**
描述为三客户端完全验收。

## 发布判定规则

- `npm run check`、`npm run test:e2e`、默认连接验证、smoke harness 自检和
  `git diff --check` 必须通过。
- `node scripts/smoke-clients.mjs --clients codex,claude,kimi --write-smoke`
  必须为每个客户端生成结构正确的证据。
- 只有 Codex、Claude Code、Kimi Code 的 `installed`、`authenticated`、
  `tools_discovered`、`identity_registered`、`project_read`、
  `progress_written`、`activity_verified` 全为 `true`，才能声明三客户端完全
  验收。
- 任一客户端失败时，命令返回非零是正确门禁行为；不得为了发布把它改成零。

## 自动化证据

2026-07-30（Asia/Hong_Kong）在
`E:\project_manage\.worktrees\project-os-full-stack` 单次、无重叠执行：

| 检查 | 命令 | 结果 |
|---|---|---|
| 全量静态/单元/构建/文档 | `npm run check` | PASS：Web 232、contracts 12、core 173（另 3 skipped）、MCP 17、server 185、Skill 5、runtime 3；lint/build/docs PASS |
| Playwright | `npm run test:e2e` | PASS：最终源码包含 `825bf60`、`0ede881`、`c0e9890`，57 passed、10 intentional project skips |
| 文档专项 | `npm run check:docs` | PASS：6 documents |
| stdio 合约 | `node integrations/project-os/scripts/verify-connection.mjs` | PASS：contract-only、22 tools、无副作用 |
| harness 自检 | `node scripts/smoke-clients.mjs --self-test` | PASS：audit/isolation/adapter/process-tree/redaction/evidence |
| 真实客户端 smoke | `node scripts/smoke-clients.mjs --clients codex,claude,kimi --write-smoke` | EXPECTED INCOMPLETE：exit 1，见下表 |
| 空白/冲突标记 | `git diff --check` | PASS |

默认连接验证应报告 `mode: "contract-only"`、`transport: "stdio"` 和
`toolCount: 22`，且 `sideEffects` 为空。

## 真实客户端证据

证据时间区：Asia/Hong_Kong。旧的 smoke 文件不作为发布依据。

### 2026-07-29 历史运行（已作废）

旧 harness 曾报告：

- Claude Code：七个验证字段均为 `true`；
- Kimi Code：七个验证字段均为 `true`；
- Codex：`installed: true`，但启动报 `spawn EPERM`，其余验证字段为
  `false`。

后续审查发现旧 harness 的身份预置和证明隔离不足，因此 Claude/Kimi 的旧
PASS 已作废，不能作为最终验收证据；Codex 的进程启动阻塞仍需用修正后的
harness 重试。保留这段记录是为了避免把历史输出误当成当前发布结论。

### 修正后重跑：2026-07-30 00:38–00:39（Asia/Hong_Kong）

| 客户端 | installed | authenticated | tools | identity | project | progress | activity | 判定 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Claude Code | true | false | false | false | false | false | false | INCOMPLETE |
| Kimi Code | true | true | true | true | true | true | true | PASS |
| Codex | true | false | false | false | false | false | false | INCOMPLETE |

精确阻塞：

- **Codex**：客户端已安装，但子进程启动返回 `spawn EPERM`，没有发现工具或
  执行任何业务调用。
- **Claude Code**：客户端已安装，但当前凭据无法安全复制到隔离 HOME，也没有
  可隔离的环境令牌。harness 主动跳过模型调用，避免把宿主凭据或宿主 MCP 配置
  带入证据。
- **Kimi Code**：隔离临时 HOME 中完成工具发现、身份注册、项目读取、进度
  写入和活动核对；七个布尔字段全部为 `true`，`error` 为 `null`，全局 Kimi
  配置在前后审计中保持不变。

真实 smoke 因 Codex 和 Claude Code 两个未完成项按设计返回非零，当前整体
发布结论为 **INCOMPLETE**；Kimi Code 单客户端结论为 **PASS**。

重试全部客户端：

```bash
npm run build
node scripts/smoke-clients.mjs --clients codex,claude,kimi --write-smoke
```

单独重试：

```bash
node scripts/smoke-clients.mjs --clients codex --write-smoke
node scripts/smoke-clients.mjs --clients claude --write-smoke
node scripts/smoke-clients.mjs --clients kimi --write-smoke
```

重试前分别处理阻塞：

- Codex：在允许启动 `codex` 子进程的交互终端/安全策略中运行单客户端命令。
- Claude Code：提供 harness 支持且可放入临时 HOME/环境的隔离凭据；不得直接
  继承宿主配置目录。
- Kimi Code：当前已通过；只有凭据、CLI 或 MCP 配置变化后才需重新运行
  单客户端命令。

真实 smoke 会产生模型调用和隔离数据库写入。证据文件位于
`artifacts/mcp-smoke/` 且被版本控制忽略；发布清单只记录经人工核对的摘要，
不提交日志、令牌或临时数据库。

## 已知部署限制

- 单实例、本地优先；没有用户登录、多租户隔离、TLS 终止或自动备份保留。
- `npm start` 只启动 API/MCP，不托管 `web/dist/`。
- 非回环监听必须配置令牌、Host/Origin 白名单和外部 TLS。
- Skill 和 stdio 配置包含本机绝对路径；仓库移动后必须重新生成或修改。
- 三客户端验收取决于本机 CLI 安装、登录状态、模型可用性和进程启动权限。
