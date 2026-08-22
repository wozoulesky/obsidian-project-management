# obsidian-project-management

以 Obsidian Vault 为**唯一项目记录**的软件开发协作 Skill：在开始开发前读取目标项目的 `SPEC.md`、`任务计划.md` 与目标任务文件；完成、暂停或交接前更新任务进度、验证证据并创建/更新 handoff；范围变化必须先写入 `SPEC.md`，不得静默偏离。

适用于需要跨 Agent 持续跟踪的软件开发任务（写代码、改代码、修 bug、重构、实现功能、新建项目、测试、代码评审、任务排期、暂停、交接、复盘）。一次性问答、查资料、与仓库无关的临时脚本**不触发**，不要写入 vault。

> 仓库内 `SKILL.md` 中的 vault 路径（如 `E:\obsidian_warehouse`）为本机默认值；部署到其他机器时请替换为你自己的 Vault 路径。

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `SKILL.md` | Skill 定义：触发条件、触发边界、强制流程与协作规则 |
| `references/vault-templates.md` | Vault 模板路径、任务 frontmatter 字段与状态/标题规范 |
| `agents/openai.yaml` | Agent 界面声明（Codex 等可识别的 display name 与 default prompt） |
| `AGENTS.md` | 编辑本仓库时的入口规则（Agent 必须遵守） |
| `README.md` | 本文件 |

## 安装

将本仓库内容复制（或软链）到目标 Agent 的 Skill 目录：

| Agent | 安装位置 |
| --- | --- |
| Codex | `~/.codex/skills/obsidian-project-management/` |
| Claude Code / OpenClaw 等 | `~/.agents/skills/obsidian-project-management/` |

> 安装 = 复制 `SKILL.md`、`agents/`、`references/` 三个内容到目标目录。

## 维护约定

- 本仓库是 Skill 的版本管理与分发来源，任何修改以本仓库提交为基准；
- 修改后单独提交并推送，再同步本机安装副本（`.codex` 与 `.agents` 两处）；
- Vault 内项目记录仍以 `E:\obsidian_warehouse` 为准，本仓库不含任何项目数据。

## 关联项目

- [dsh-obsidian（DSH Bridge）](https://github.com/wozoulesky/dsh-obsidian)：本机 DSH 嵌入 Obsidian 的 AI 协作者插件，其开发任务遵循本 Skill 流程（项目记录见 Obsidian「dsh-obsidian（DSH 嵌入 Obsidian 插件）」）

## 历史

本仓库原为 Project OS（本地项目管理工作台：Web + REST API + SQLite + MCP），代码已从 `main` 分支移除。旧代码保留在 git 历史与标签 `v1.0.0`–`v1.3.0` 中，不再维护。