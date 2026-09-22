# 项目记录规则

处理软件开发任务前，必须先用 `skill` 工具加载 `project-records`（即 `$project-records`）。

**记录位置：本仓库内 `records/`**——一般项目形态 `<项目根>/records/`，本 Skill 自身的开发记录就写在仓库里。本仓库是公开仓库，`records/` 与 `config.json` 均由 `.gitignore` 忽略、不入库；记录位置以本文件声明为准。Vault 里的 `软件开发\Project Records（项目记录）\` 是 2026-09-22 迁移前的**只读归档**，不新增、不改写。

开始实现前读 `records/SPEC.md`、`records/任务计划.md` 与在途变更；完成、暂停或交接前更新进度、写验证证据与 handoff；范围变化先写 `records/SPEC.md`，不得静默偏离。新项目或新目录需要记录骨架时用 `/records-init`（跑 `scripts/init-records.sh`，Windows 上可用 `scripts/init-records.ps1`）。

以上仅适用于需要持续跟踪的软件开发任务；一次性问答、题外话、与仓库无关的临时脚本不触发、不写盘。
