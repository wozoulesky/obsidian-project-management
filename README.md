# obsidian-project-management

以**项目自身**为记录的软件开发协作 Skill：**记录跟着项目走**——一般项目（代码仓、策划目录、数据抓取目录……）写在项目根的 `records/`；Vault 里只装记录的项目目录，本身就是记录根。位置可由项目的 `AGENTS.md` 或用户当场指定覆盖（本仓库就声明记录留在 Vault）。

**记录是否纳入版本控制（提交、推送、公开）由用户与 Agent 协商，本 Skill 不规定。**

## 它做什么

- **使用前提**：触发后先**确定记录位置**（项目根 → 记录位置 → 需要时建最小骨架）；位置不可读或不可写就明确告知用户这是 skill 故障（不静默跳过、不假装已记录），再读 `SPEC.md`、`任务计划.md` 与在途变更；
- **变更单位**：默认单文件 `变更.md`，命中触发线（子项 ≥3 / 需跨会话或跨 Agent 交接 / 范围或验收标准要写进 SPEC / 要留完整验证证据）升级为 `spec.md` + `任务.md` + `handoff.md`；
- **写入触发对照**：新项目、功能变动、任务推进、计划变化、评审验收、暂停交接——每类场景最少要写什么，`SKILL.md` 里列成表，强制写入，不等用户提醒；
- **SPEC 的分工**：`SPEC.md` 是系统总规格（粗粒度、可通读）；项目已有 `openspec/` 之类规格体系时分层协作——规格正文留在那里，记录侧只管进程与交接；没有规格体系的，用变更内的 `spec.md` 当轻量 delta，收尾并入总规格；
- **收尾**：写验证证据、更新状态与下一步、多文件形态写 `handoff.md`；是否提交进版本控制由用户与 Agent 协商，一旦决定提交就守：只 add 本次涉及的路径、push 前 `pull --rebase`、禁强推、声称「已备份」须附 commit hash。

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `SKILL.md` | Skill 定义：触发条件、触发边界、使用前提（确定记录位置 / 写入触发对照）、记录位置与结构、变更单位、SPEC 分工、开发流程与收尾 |
| `references/records-templates.md` | 字段/状态/标题规范；SPEC、任务计划、变更（单/多文件）、数据抓取模板；迁移检查表 |
| `config.example.json` | Vault 根配置的占位示例（真实配置 `config.json` 不入库） |
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

**Vault 根配置**：记录位于 Vault 内时，Skill 只从技能目录下的 `config.json` 读取 `vaultRoot`；复制本仓库的 `config.example.json` 为 `config.json` 并填上自己的 Vault 路径即可（该文件不入库）。

## 维护约定

- 本仓库是 Skill 的版本管理与分发来源，任何修改以本仓库提交为基准；
- 修改后单独提交并推送，**再同步本机安装副本（`.codex` 与 `.agents` 两处）**；安装副本落后会让其他 Agent 加载到旧规则；
- 本仓库不含任何项目数据：**本仓库自己的记录写在 Vault**（`软件开发\Project OS（Obsidian迁移）\`），见 `AGENTS.md` 的声明。

## 关联项目

- [dsh-obsidian（DSH Bridge）](https://github.com/wozoulesky/dsh-obsidian)：本机 DSH 嵌入 Obsidian 的 AI 协作者插件，其开发任务遵循本 Skill 流程。

## 历史

本仓库原为 Project OS（本地项目管理工作台：Web + REST API + SQLite + MCP），代码已从 `main` 分支移除，保留在 git 历史与标签 `v1.0.0`–`v1.3.0` 中，不再维护。

此后一度以本机 Obsidian Vault 为唯一项目记录（v1.x 版 Skill）；2026-09-22 起改为**记录跟着项目走**：记录写进项目自身，Vault 只承载记录本就放在 Vault 里的项目与历史归档。
