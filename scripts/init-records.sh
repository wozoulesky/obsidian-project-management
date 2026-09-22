#!/usr/bin/env bash
# init-records：在当前项目根建 records/ 最小骨架（SPEC.md 草稿 + 任务计划.md + 变更/.gitkeep）
# 只补缺，不覆盖；不碰 Vault；是否把 records/ 纳入版本控制由用户决定。
# 用法：bash scripts/init-records.sh [项目目录]
set -u

target="${1:-}"

if [ -n "$target" ]; then
  [ -d "$target" ] || { echo "目标目录不存在：$target" >&2; exit 2; }
  root="$(cd "$target" && pwd)"
else
  root="$(git rev-parse --show-toplevel 2>/dev/null)"
  [ -n "${root:-}" ] || root="$(pwd)"
  root="$(cd "$root" && pwd)"
fi

skeleton="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skeleton"
[ -d "$skeleton" ] || { echo "缺少模板目录：$skeleton" >&2; exit 3; }

project="$(basename "$root")"
stamp="$(date '+%Y-%m-%d %H:%M')"
records="$root/records"
created=0
skipped=0

install_stub() { # $1 模板名，$2 目标文件
  if [ -e "$2" ]; then
    echo "跳过（已存在）  $2"
    skipped=$((skipped + 1))
    return 0
  fi
  mkdir -p "$(dirname "$2")"
  sed -e "s/{{项目}}/$project/g" -e "s/{{时间}}/$stamp/g" "$skeleton/$1" > "$2"
  echo "已创建          $2"
  created=$((created + 1))
}

echo "项目根：$root"
install_stub "SPEC.md" "$records/SPEC.md"
install_stub "任务计划.md" "$records/任务计划.md"

mkdir -p "$records/变更"
if [ -e "$records/变更/.gitkeep" ]; then
  echo "跳过（已存在）  $records/变更/.gitkeep"
  skipped=$((skipped + 1))
else
  : > "$records/变更/.gitkeep"
  echo "已创建          $records/变更/.gitkeep"
  created=$((created + 1))
fi

echo
echo "完成：新建 $created 个，跳过 $skipped 个。"
echo "下一步：填 records/SPEC.md 的「系统是什么」「当前阶段与范围」并请用户确认；是否把 records/ 纳入版本控制由你与用户协商。"
