---
name: obsidian-project-management
description: |
  MUST USE / 强制使用：本环境任何“软件开发任务”开始前必须先加载本 skill——写代码、
  改代码、开发新项目、功能变动、新增功能、修复 bug、重构、测试、代码评审、任务变更/
  状态推进、计划与排期、提交/合并、验收、暂停、交接、复盘，以及任何涉及 SPEC.md、
  任务计划.md、任务/、handoff/ 或 E:\obsidian_warehouse 的工作。Also use when
  starting, planning, implementing, reviewing, pausing, or handing off a software-development
  task whose scope, progress, verification, or ownership could drift between agents. 规则：未加载
  本 skill 不得开始开发；触发后先自动探索 vault 并自检连接（无法连接必须通知用户 skill 失效）；
  以 E:\obsidian_warehouse 为唯一项目记录。不适用（不要触发、不要写 vault）：一次性
  问答、查资料、问概念、日常聊天、与仓库无关的临时脚本——除非用户明确要求记录。
---

# Obsidian Project Management

## 强制触发（先于一切开发动作）

当本会话出现下列任何一种情况时，必须先走本流程、再开始实现——**不要等用户提醒**：

- **开发新项目 / 新功能**（含写代码、测试、提交/合并）；
- **任务变更**：状态推进、范围调整、依赖或顺序变化、重新排期；
- **功能变动**：修改既有行为、重构、修复 bug；
- **计划与排期**：`任务计划.md` 调整、跨项目优先级变化（`总任务排期.md`）；
- **评审与验收**：代码评审、验收结果、验证证据；
- **暂停 / 交接 / 复盘**。

流程：先自动探索并读取 vault 中对应项目的 `SPEC.md`、`任务计划.md` 与目标任务文件（见下节「使用前提」）；开发过程中把任务变更与功能变动写入对应记录；完成、暂停或交接前更新任务进度、验证证据并写 handoff。不得跳过 vault 记录直接改代码。

## 触发边界（防止题外话过度写入）

仅"需要在 `E:\obsidian_warehouse` 中持续跟踪的软件开发任务"强制走本流程。一次性问答、查资料、问概念、日常聊天、与仓库无关的临时脚本等题外话**不触发**本 skill：不得创建任务记录、不得新建/修改 vault 文件，除非用户明确要求记录。拿不准时先询问用户是否需要记录，不要自作主张写盘。

## 使用前提（每次触发先执行）

### A. 连接自检（先于任何 vault 操作）

用可用通道各探测一次（优先 MCP）：

- **MCP**：若工具列表里存在 obsidian 的 MCP 工具（如 `mcp__obsidian__get_server_info`），调用一次验证连通；
- **文件系统**：直接读 vault 根 `E:\obsidian_warehouse`（列目录或读 `README.md`）。

判定与处理：

- **两个通道都失败** → 立即停止流程，并**明确通知用户**（这是 skill 故障，不是普通报错）：

  > ⚠️ obsidian-project-management skill 无法连接 Obsidian vault，本次无法记录。

  附排查清单（逐项给出结论）：① Obsidian 是否在运行；② MCP Connector 插件是否启用（vault 的 `.obsidian/plugins/mcp-tools-istefox/`）；③ 端口 / token 是否变化（对照本机 MCP 客户端配置，如 `~/.kimi-code/mcp.json`，与插件 `data.json`）；④ vault 路径是否被移动。
  然后让用户选择：修复后重试，或本次不记录继续开发（继续时必须在最终回复注明"本次未写入 vault"）。**不得静默跳过、不得假装已记录。**

- **仅一个通道可用** → 继续流程，并在首次回复中注明降级情况（例如"MCP 未连接，本次用文件系统直读直写"）。

- 任何 vault 写入失败都如实报告，不得声称成功。

### B. 自动探索 vault（定位本次任务的记录）

1. 读 vault 根 `README.md` 与 `软件开发\总任务排期.md`（项目优先级与工程目录）；
2. 列出 `软件开发\` 下的项目目录；
3. 按当前工作目录、仓库名、用户提到的项目名**模糊匹配**与会话任务对应的项目（例：`E:\noval-agent-dev` ↔「Noval Agent（多 Agent 小说创作系统）」）；
4. 读取匹配项目的 `README.md`、`SPEC.md`、`任务计划.md` 与目标任务文件；
5. 匹配不到：向用户列出候选确认；确认是新项目时，按 `软件开发\模板` 建项目目录（先经用户确认），再进入流程。

用 MCP 时路径为 vault 相对路径（如 `软件开发/总任务排期.md`）；用文件系统时为 vault 绝对路径（`E:\obsidian_warehouse\...`）。

### C. 写入触发对照（何时必须写、写什么）

| 场景 | 至少写入 |
| --- | --- |
| 开发新项目 | 按 `软件开发\模板` 建项目目录（README / SPEC / 任务计划 / 任务 / handoff / 决策 / 日志） |
| 新增功能 / 功能变动 | 任务文件（进度记录）；涉及范围时更新 `SPEC.md`（范围变更记录与相关章节） |
| 任务开始 / 推进 / 变更 | 任务文件：状态、负责人、最后更新、进度记录；必要时 `任务计划.md` |
| 计划 / 排期 / 依赖变化 | `任务计划.md`；跨项目优先级变化时更新 `软件开发\总任务排期.md` |
| 评审 / 验收结果 | 任务文件「验证」节（命令、输出、证据） |
| 完成 / 受阻 / 暂停 / 交接 | 任务文件（状态、下一步）+ 新建 `handoff\` 文件（必须），并互相链接 |

以上写入属于强制流程：**不要等用户提醒，也不要只留在对话里。**

---

Treat `E:\obsidian_warehouse` as the source of truth for local project coordination. Keep one project per folder, one task per task file, and use `SPEC.md` to prevent unapproved scope drift.

## Required layout

```text
E:\obsidian_warehouse\
├─ 软件开发\<项目名>\
│  ├─ README.md
│  ├─ SPEC.md
│  ├─ 任务计划.md
│  ├─ 任务\<任务-ID> <任务名>.md
│  ├─ handoff\YYYY-MM-DD <主题>.md
│  ├─ 决策\
│  └─ 日志\
└─ 每日数据抓取\YYYY-MM-DD\
   ├─ 数据.md
   ├─ 来源.md
   └─ 运行日志.md
```

Create a project from the Vault templates at `软件开发\模板` when it does not exist. Use `每日数据抓取\模板` only for date-based data collection; never put development progress there.

Read [vault-templates.md](references/vault-templates.md) before creating a project, task, handoff, or collection-day record.

## Development lifecycle

### 1. Before work

1. Locate the project under `软件开发`（见「自动探索」）.
2. Read `README.md`, `SPEC.md`, `任务计划.md`, and the target task file.
3. Check the task frontmatter. If another agent owns a task in `进行中` state, do not overwrite it; choose another task or ask for coordination.
4. Set the target task to `进行中`, set `负责人` to the current agent identity, update `最后更新`, and add a timestamped entry to `进度记录` explaining what was read and what will be done.

Do not start implementation without a SPEC. If one is absent, create a draft and ask the user to approve it before implementing beyond exploration.

### 2. Keep work aligned

Use `SPEC.md` as the test of scope:

- Deliver only work required by `范围` and `验收标准`.
- Treat `非目标` and `约束` as hard boundaries.
- If the latest explicit user instruction conflicts with the SPEC, record that instruction in `范围变更记录`, revise the relevant SPEC sections, and then continue.
- If scope is unclear or materially expands without an explicit user instruction, stop implementation, record the question under the task's `阻塞与风险`, and ask the user.

Update `进度记录` when a meaningful decision, blocker, verification result, or change in plan occurs. Keep task plans specific and ordered; update `任务计划.md` when dependencies, phases, or priorities change.

### 3. Close or transfer work

Before declaring work complete or stopping for any reason:

1. Record verification commands, outputs, review evidence, or the reason verification could not run in `验收`.
2. Update `状态`, `最后更新`, `阻塞与风险`, and `下一步` in the task file.
3. Create a new handoff file in `handoff/`, even for a blocked task. State completed work, unfinished work, exact next step, verification evidence, risks, and any SPEC deviation.
4. Link the handoff from the task file.

Use `已完成` only when the task's relevant SPEC acceptance criteria have evidence. Use `受阻` when external input or a decision is needed. Never silently mark incomplete work as complete.

## Daily data collection

For a data collection run, create `每日数据抓取\YYYY-MM-DD\` and copy the three templates. Record the output in `数据.md`, every source or local input in `来源.md`, and commands, times, errors, and results in `运行日志.md`.

## Non-negotiable rules

- Do not store project status only in chat; write it to the Vault.
- Do not modify another agent's active task record except to add a clearly attributed coordination note.
- Do not rewrite or remove earlier progress and handoff records; append corrections with timestamps.
- Do not treat a code change as task completion without SPEC-based verification.
- Do not create a second source of truth in Project OS, a database, or a private scratch file.
- If the Vault is unreachable or a write fails, tell the user explicitly that this skill is failing — never skip recording silently or pretend records were written.
