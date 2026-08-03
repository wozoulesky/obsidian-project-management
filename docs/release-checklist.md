# 发布检查清单

本文件只记录实际执行的证据。v1.3.0 的仓库、浏览器和生产构建烟测证据记录在
下方；真实模型客户端边界仍沿用修正后的隔离 harness 结果：Kimi Code 完整
通过，Codex 和 Claude Code 仍未满足全部字段，因此本版本**不得**描述为
三客户端完全验收。

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

## v1.3.0 项目生命周期与任务多视图验收证据

2026-08-03 09:17–09:43（Asia/Hong_Kong）在
`E:\project_manage\.worktrees\v1.3-project-task-workspaces` 的候选提交上串行执行：

| 检查 | 命令 | 当前证据 |
|---|---|---|
| 完整静态、单元、构建与文档门禁 | `npm run check` | PASS（exit 0）：Web 527、contracts 27、core 258（另 3 skipped）、MCP 25、server 202、Skill 6、脚本 6，共 1051 passed；lint/build/docs PASS |
| 桌面 Playwright | `npm run test:e2e -- --project=desktop` | PASS（exit 0）：43 passed、6 个按项目规则 intentional skipped、0 failed；包含桌面视觉、布局、路由与自动无障碍检查 |
| 紧凑布局 Playwright | `npm run test:e2e -- --project=compact` | PASS（exit 0）：38 passed、11 个按项目规则 intentional skipped、0 failed；包含 390px/600px 响应式、键盘和详情抽屉检查 |
| 真实服务浏览器旅程 | `npm run test:e2e -- --project=real-browser-journeys` | PASS（exit 0）：20/20；覆盖项目永久删除、默认项目保护、409 恢复、任务多视图、看板持久化、快速提交、项目/负责人/设置和清理分页边界 |

生产构建浏览器烟测使用隔离端口 `4174`/`4311` 和一次性 SQLite 数据库；完成后
临时服务、数据库、日志和代理配置均已删除，未触碰用户正在运行的 `5173`/`4310`
服务。

| 烟测项 | 实际结果 |
|---|---|
| 默认项目无永久删除入口 | PASS：操作菜单只显示禁用的“默认项目受保护，无法删除” |
| 一次性项目精确名称删除 | PASS：确认按钮在名称不匹配时禁用，输入 `Release Smoke v1.3` 后启用，删除后返回项目列表且项目消失 |
| 视图切换保留筛选和选中任务 | PASS：`q=Release`、`priority=P1`、`selected=<task-id>` 在看板/时间线切换后保留，右侧上下文仍为同一任务 |
| 看板移动刷新后持久化 | PASS：`Release board smoke` 移到“已完成”后刷新仍位于已完成列，进度规范化为 100% |
| 紧凑布局详情抽屉 | PASS：390×844 视口下“查看任务详情”打开带遮罩和关闭按钮的对话框抽屉 |

本轮最终代码审查未发现 Critical 或 Important 产品缺陷；发布元数据补齐后，审查中
唯一的阻塞项已关闭。搜索输入历史粒度和极长/含尖括号项目名的删除成功提示被记录为
非阻塞 Minor，均不影响删除事务、数据留存或任务状态持久化。

## v1.2.0 前端重构验收证据

2026-08-02（Asia/Hong_Kong）在
`E:\project_manage\.worktrees\task-console-prototype` 的候选提交上执行：

| 检查 | 命令 | 当前证据 |
|---|---|---|
| 完整静态、单元、构建与文档门禁 | `npm run check` | PASS：Web 320、contracts 21、core 245（另 3 skipped）、MCP 25、server 191、Skill 6、脚本 6；lint/build/docs PASS |
| 完整浏览器门禁 | `npm run test:e2e` | PASS：85 passed，16 个按项目/视口规则 intentional skipped，0 failed；包含桌面、紧凑和真实服务三套项目 |
| 真实服务浏览器旅程 | 上述门禁的 `real-browser-journeys` 项目 | PASS：9/9，覆盖失败恢复、项目选择、项目/任务创建、负责人 CRUD、设置持久化与快速提交 SQLite 持久化 |
| E2E 服务直接启动 | `node scripts/e2e-server.mjs --shutdown-after-ready` | PASS：Windows / Node.js 24 下完成构建、启动随机 API 与 4173 预览并正常关闭，无 `spawn EINVAL` |
| 默认连接验证 | `node integrations/project-os/scripts/verify-connection.mjs --database <isolated-db>` | PASS：`contract-only`、stdio、27 tools、`sideEffects: []` |
| smoke harness 自检 | `node scripts/smoke-clients.mjs --self-test` | PASS：audit、isolation、invocation adapter、process tree、redaction、evidence |
| 空白/冲突标记 | `git diff --check` | PASS |

v1.2.0 没有把浏览器自动化或 MCP contract-only 验证当作真实模型客户端写入
证据。Codex、Claude Code、Kimi Code 的三客户端状态仍沿用下方已记录的真实
边界，因此本版本**不得**描述为“三客户端完全验收”。

## v1.1.0 接力验收证据

以下 focused 结果来自当前 v1.1 集成工作；它们证明接力链路的对应层，不替代
最终全量门禁：

| 检查 | 命令 | 当前证据 |
|---|---|---|
| MCP exact double-Agent relay | `npm test --workspace @project-os/mcp -- --run src/mcp-tools.test.ts` | PASS：当前 focused 文件 23/23；精确场景验证 Agent A checkout 后，Agent B 首次 check-in briefing 收到 handoff、deliverable 与增量 activity |
| REST collaboration routes | `npm test --workspace @project-os/server -- --run src/routes/collaboration-routes.test.ts` | PASS：5/5 |
| Web unit/integration | `npm test --workspace web` | PASS：237/237 |
| Skill v2 contract | `npm test --workspace @project-os/skill -- --run skill.test.ts` | PASS：精确 27-tool surface、三幕接力和 contract-only verifier |
| 最终仓库门禁 | `npm run check` | PASS：2026-07-30（Asia/Hong_Kong）在 `codex/v1.1-relay` fresh 执行，Web 237、contracts 21、core 244（另 3 skipped）、MCP 25、server 190、Skill 6、runtime 3；lint/build/docs PASS |

REST 的 5/5、Web 的 237/237 和上述 fresh `npm run check` 是当前集成证据
摘要；最终发布仍需按本清单另行完成 `npm run test:e2e`、`git diff --check`
以及真实客户端 smoke 边界核对。

v1.1 尚未重新完成三种真实模型客户端的全量写入 smoke。下面保留的真实客户端
状态仍然是真实边界：Kimi Code 通过，Codex 与 Claude Code 未完成。因此
v1.1 候选版本同样**不得**描述为“三客户端完全验收”，也不得把 double-Agent
自动化测试当成真实客户端调用证据。

## v1.0 基线自动化证据（历史）

2026-07-30（Asia/Hong_Kong）在
`E:\project_manage\.worktrees\project-os-full-stack` 单次、无重叠执行：

| 检查 | 命令 | 结果 |
|---|---|---|
| 全量静态/单元/构建/文档 | `npm run check` | PASS：Web 232、contracts 12、core 173（另 3 skipped）、MCP 17、server 185、Skill 5、runtime 3；lint/build/docs PASS |
| Playwright | `npm run test:e2e` | PASS：最终源码包含 `825bf60`、`0ede881`、`c0e9890`，57 passed、10 intentional project skips |
| 文档专项 | `npm run check:docs` | PASS：6 documents，且 fresh-clone 自检在模拟 `apps/mcp/dist/stdio.js` 缺失时通过 |
| stdio 合约 | `node integrations/project-os/scripts/verify-connection.mjs` | PASS：contract-only、当时的完整 tool surface、无业务 tool 写入；启动打开/迁移默认 SQLite |
| harness 自检 | `node scripts/smoke-clients.mjs --self-test` | PASS：audit/isolation/adapter/process-tree/redaction/evidence |
| 真实客户端 smoke | `node scripts/smoke-clients.mjs --clients codex,claude,kimi --write-smoke` | EXPECTED INCOMPLETE：exit 1，见下表 |
| 空白/冲突标记 | `git diff --check` | PASS |

该历史运行的默认连接验证报告了 `mode: "contract-only"`、
`transport: "stdio"`，且 `toolCount` 与当时的合约一致、`sideEffects` 为空。
当前 v1.1 verifier 的精确合约为 27 tools。这里的空数组只表示没有
Agent/project/task/activity 等业务 tool 写入；stdio 启动仍会打开指定 SQLite，
并可能创建目录、数据库、WAL 或执行 migrations。若不能触碰目标数据库，应使用
临时 `--database` 路径。

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
