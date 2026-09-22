# obsidian-project-management

以**项目自身**为记录的软件开发协作 Skill：**记录跟着项目走**——有 git 仓库的项目写在仓库根 `records/`，与代码同一份 git 历史；没有仓库的项目（数据抓取、纯策划）写本地 Obsidian Vault；某个仓库也可以在它自己的 `AGENTS.md` 里声明把记录留在 Vault（本仓库就这么做）。

## 它做什么

- **使用前提**：触发后先做**通道自检**——仓库通道（`git rev-parse` + `records/`）或 vault 通道（MCP / 文件系统），所需通道不可用就明确告知用户 skill 故障并给排查清单，绝不静默跳过；再**定位记录**（读 `SPEC.md`、`任务计划.md` 与在途变更）；
- **变更单位**：默认单文件 `变更.md`，命中触发线（子项 ≥3 / 需跨会话或跨 Agent 交接 / 范围或验收标准要写进 SPEC / 要留完整验证证据）升级为 `spec.md` + `任务.md` + `handoff.md`；
- **写入触发对照**：新项目、功能变动、任务推进、计划变化、评审验收、暂停交接——每类场景最少要写什么，`SKILL.md` 里列成表，强制写入，不等用户提醒；
- **SPEC 的分工**：`SPEC.md` 是系统总规格（粗粒度、可通读）；仓库已有 `openspec/` 之类规格体系时分层协作——规格正文留在那里，记录侧只管进程与交接；没有规格体系的，用变更内的 `spec.md` 当轻量 delta，收尾并入总规格；
- **收尾与提交**：写验证证据后，记录与代码**同一次提交**，`git add` 只带本次涉及的路径，push 前 `pull --rebase`，禁强推，声称「已备份」须附 commit hash。

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `SKILL.md` | Skill 定义：触发条件、触发边界、使用前提（通道自检 / 定位记录 / 写入触发对照）、记录位置与结构、变更单位、开发流程与提交规范 |
| `references/records-templates.md` | 字段/状态/标题规范；SPEC、任务计划、变更（单/多文件）、数据抓取模板；迁移检查表 |
| `agents/openai.yaml` | Agent 界面声明（Codex 等可识别的 display name 与 default prompt） |
| `AGENTS.md` | 编辑本仓库时的入口规则（含本仓库的记录位置声明） |
| `README.md` | 本文件 |

## 安装

本仓库即一个标准 **Agent Skill**（`SKILL.md` + `references/` + `agents/`），任何支持 Agent Skills 规范的 Agent 都能加载：克隆或下载后，把内容放进该 Agent 的 Skills 目录，**目录名保持 `obsidian-project-management`**（Skill 按目录名发现），Agent 即自动识别。

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
- 修改后单独提交并推送，**再同步本机安装副本（`.codex` 与 `.agents` 两处）**；安装副本落后会让其他 Agent 加载到旧规则；
- 本仓库不含任何项目数据：**本仓库自己的记录写在 Vault**（`软件开发\Project OS（Obsidian迁移）\`），见 `AGENTS.md` 的声明。

## 关联项目

- [dsh-obsidian（DSH Bridge）](https://github.com/wozoulesky/dsh-obsidian)：本机 DSH 嵌入 Obsidian 的 AI 协作者插件，其开发任务遵循本 Skill 流程。

## 历史

本仓库原为 Project OS（本地项目管理工作台：Web + REST API + SQLite + MCP），代码已从 `main` 分支移除，保留在 git 历史与标签 `v1.0.0`–`v1.3.0` 中，不再维护。

此后一度以本机 Obsidian Vault 为唯一项目记录（v1.x 版 Skill）；2026-09-22 起改为**记录跟着项目走**：记录随代码进各项目仓库，Vault 承载没有仓库的项目（数据抓取、纯策划）、自行声明留在 Vault 的仓库，以及历史归档。
