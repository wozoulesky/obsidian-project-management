# obsidian-project-management

以 Obsidian Vault 为**唯一项目记录**的软件开发协作 Skill：在开始开发前读取目标项目的 `SPEC.md`、`任务计划.md` 与目标任务文件；完成、暂停或交接前更新任务进度、验证证据并创建/更新 handoff；范围变化必须先写入 `SPEC.md`，不得静默偏离。

适用于需要跨 Agent 持续跟踪的软件开发任务（写代码、改代码、修 bug、重构、实现功能、新建项目、测试、代码评审、任务排期、暂停、交接、复盘）。一次性问答、查资料、与仓库无关的临时脚本**不触发**，不要写入 vault。

> 仓库内 `SKILL.md` 中的 vault 路径为本机默认值；部署到其他机器时请替换为你自己的 Vault 路径。

## 背景

在本机同一台机器上，多个人与多个 Agent（Codex、Claude Code、DSH 等）交替开发一个项目时，最常见的问题是：任务状态、决策与验收证据散落在不同会话、聊天记录和私有草稿里，换一个 Agent 就"失忆"，范围在不知不觉中偏离。前身项目 Project OS 用 Web + REST API + SQLite + MCP 保存协作状态，功能完整，但在本机 Agent 场景下需要持续维护后端、数据库与同步层，维护成本高于收益。

本项目的方案：**把 Obsidian Vault 当作唯一项目记录**——项目、SPEC、任务、进度、handoff 全部以 Markdown 保存，人与 Agent 直接读写、可审计、可版本管理；同时把"开始前读取 SPEC/计划/任务、过程中记录进度、结束时留下验证证据与 handoff"的强制流程沉淀为一个标准 Agent Skill（即本仓库），任何 Agent 装上后都按同一套规则工作。无论谁接手，状态都在 Vault 里，不依赖某个会话的记忆。

本仓库是该 Skill 的版本管理与分发仓库。

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `SKILL.md` | Skill 定义：触发条件、触发边界、强制流程与协作规则 |
| `references/vault-templates.md` | Vault 模板路径、任务 frontmatter 字段与状态/标题规范 |
| `agents/openai.yaml` | Agent 界面声明（Codex 等可识别的 display name 与 default prompt） |
| `AGENTS.md` | 编辑本仓库时的入口规则（Agent 必须遵守） |
| `README.md` | 本文件 |

## 安装

本仓库即一个标准 **Agent Skill**（`SKILL.md` + `references/` + `agents/`），任何支持 Agent Skills 规范的 Agent 都能加载：克隆或下载后，将仓库内容放进该 Agent 的 Skills 目录，**目录名保持 `obsidian-project-management`**（Skill 按目录名发现），Agent 即自动识别。

```bash
# 方式一：克隆到 Skills 目录（以 Claude Code / Codex 为例）
git clone --depth 1 https://github.com/wozoulesky/obsidian-project-management ~/.claude/skills/obsidian-project-management
# 方式二：软链接（保留单份源码，便于跟随更新）
ln -s /path/to/checkout ~/.codex/skills/obsidian-project-management
```

各 Agent 常见 Skills 目录（以官方文档为准）：

| Agent | 常见目录 |
| --- | --- |
| Claude Code / Cursor 等 | `~/.claude/skills/` |
| Codex CLI | `~/.codex/skills/` |
| OpenClaw 等 | `~/.agents/skills/` |

Windows 上对应 `%USERPROFILE%\.claude\skills\` 等；企业/沙箱环境可自定义 Skills 根目录，原理相同。

## 维护约定

- 本仓库是 Skill 的版本管理与分发来源，任何修改以本仓库提交为基准；
- 修改后单独提交并推送，再同步本机安装副本（`.codex` 与 `.agents` 两处）；
- Vault 内项目记录仍以本机唯一项目记录 Vault 为准，本仓库不含任何项目数据。

## 关联项目

- [dsh-obsidian（DSH Bridge）](https://github.com/wozoulesky/dsh-obsidian)：本机 DSH 嵌入 Obsidian 的 AI 协作者插件，其开发任务遵循本 Skill 流程（项目记录见 Obsidian「dsh-obsidian（DSH 嵌入 Obsidian 插件）」）

## 历史

本仓库原为 Project OS（本地项目管理工作台：Web + REST API + SQLite + MCP），代码已从 `main` 分支移除。旧代码保留在 git 历史与标签 `v1.0.0`–`v1.3.0` 中，不再维护。