---
name: records-init
description: 给当前项目一键建记录骨架（records/SPEC.md 草稿 + 任务计划.md + 变更/.gitkeep），只补缺、不覆盖、可重复运行；project-records 的配套 skill。
whenToUse: 用户说 /records-init、records-init、「初始化记录」，或新项目要开工但还没有 records/ 时
---

# 初始化记录（records-init）

`project-records` 的配套 skill：只负责**建骨架**这一件事；骨架建好之后的 SPEC 起草、变更认领、收尾流程走 `project-records`。

在**当前项目目录**建最小骨架：**只补缺、不覆盖、可重复运行**；不碰 Vault、不动 `.gitignore`、不 `git add`。

## 怎么跑

脚本在 `project-records` skill 的 `scripts/` 下。**平级安装**（推荐形态，`<skills-dir>/{project-records,records-init}/`）时：

```bash
bash "${KIMI_SKILL_DIR}/../project-records/scripts/init-records.sh"                   # 当前 git 仓库根（没有 git 用当前目录）
bash "${KIMI_SKILL_DIR}/../project-records/scripts/init-records.sh" /path/to/project  # 或指定项目目录
powershell -NoProfile -File "<skills-dir>\project-records\scripts\init-records.ps1" [-Path C:\path\to\project]
```

若你就在父 skill 目录里（仓库内形态 `.../project-records/records-init/`），等价路径是 `../scripts/init-records.sh`。**动手前先确认路径存在**（`ls` / `dir` 一下）——两种形态只差这一段，别猜。

跑之前先看 `records/` 在不在：已在的跑一遍读 skipped 清单即可，**不要为了重跑而删目录**。

## 落盘

| 文件 | 初始内容 |
| --- | --- |
| `records/SPEC.md` | 草稿，`状态: 待确认`（模板 `<父 skill>/scripts/skeleton/SPEC.md`） |
| `records/任务计划.md` | 阶段表空表（模板 `<父 skill>/scripts/skeleton/任务计划.md`） |
| `records/变更/.gitkeep` | 空占位；**不受「变更目录只允许五种文件名」约束**——那条管的是 `变更/<日期 主题>/` 内部 |

## 建完之后（交回父 skill）

1. 起草 `SPEC.md` 的「系统是什么」「当前阶段与范围」，请用户确认；
2. 按 `project-records` 的「开发流程」认领第一个变更；
3. 是否把 `records/` 纳入版本控制由用户与 Agent 协商（本 skill 不规定）；
4. 向用户回报新建/跳过的文件清单。

## 安装形态（维护者看）

- Kimi Code 的技能扫描**只认技能目录的直接子项**（`skills/<name>/SKILL.md` 或 `skills/<name>.md`），**不递归**——本 skill 若躺在 `project-records/records-init/` 里不会被发现（依据：[Agent Skills 文档](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html)）；
- 因此它与 `project-records` **平级**安装到同一 skills 目录；仓库里保留 `records-init/` 只是为了与父 skill 同源分发，安装时两者一起复制；
- 调用方式：`/skill:records-init`，或模型按 `description` / `whenToUse` 自动触发。
