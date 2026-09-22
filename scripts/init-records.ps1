# init-records：在当前项目根建 records/ 最小骨架（SPEC.md 草稿 + 任务计划.md + 变更\.gitkeep）
# 只补缺，不覆盖；不碰 Vault；是否把 records/ 纳入版本控制由用户决定。
# 用法：powershell -NoProfile -File scripts\init-records.ps1 [-Path 项目目录]
param(
    [Parameter(Position = 0)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'
# PowerShell 5.1 默认按控制台代码页输出；管道里（Git Bash 等 UTF-8 消费端）中文会乱码
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-ProjectRoot {
    param([string]$Target)
    if ($Target) {
        if (-not (Test-Path -LiteralPath $Target -PathType Container)) { throw "目标目录不存在：$Target" }
        return (Resolve-Path -LiteralPath $Target).Path
    }
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $top = & git rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $top) { return (Resolve-Path -LiteralPath $top).Path }
    }
    return (Get-Location).Path
}

$root = Resolve-ProjectRoot -Target $Path
$skeleton = Join-Path $PSScriptRoot 'skeleton'
if (-not (Test-Path -LiteralPath $skeleton -PathType Container)) { throw "缺少模板目录：$skeleton" }

$project = Split-Path -Leaf $root
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$records = Join-Path $root 'records'
$created = 0
$skipped = 0

function Install-Stub {
    param([string]$Name, [string]$Dest)
    if (Test-Path -LiteralPath $Dest) {
        Write-Output "跳过（已存在）  $Dest"
        $script:skipped++
        return
    }
    $dir = Split-Path -Parent $Dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $text = [System.IO.File]::ReadAllText((Join-Path $skeleton $Name), [System.Text.Encoding]::UTF8)
    $text = $text.Replace('{{项目}}', $project).Replace('{{时间}}', $stamp)
    [System.IO.File]::WriteAllText($Dest, $text, $utf8NoBom)
    Write-Output "已创建          $Dest"
    $script:created++
}

Write-Output "项目根：$root"
Install-Stub -Name 'SPEC.md' -Dest (Join-Path $records 'SPEC.md')
Install-Stub -Name '任务计划.md' -Dest (Join-Path $records '任务计划.md')

$changeDir = Join-Path $records '变更'
if (-not (Test-Path -LiteralPath $changeDir)) {
    New-Item -ItemType Directory -Path $changeDir -Force | Out-Null
    Write-Output "已创建          $changeDir"
}
$keep = Join-Path $changeDir '.gitkeep'
if (Test-Path -LiteralPath $keep) {
    Write-Output "跳过（已存在）  $keep"
    $skipped++
}
else {
    [System.IO.File]::WriteAllText($keep, '', $utf8NoBom)
    Write-Output "已创建          $keep"
    $created++
}

Write-Output ''
Write-Output "完成：新建 $created 个，跳过 $skipped 个。"
Write-Output '下一步：填 records/SPEC.md 的「系统是什么」「当前阶段与范围」并请用户确认；是否把 records/ 纳入版本控制由你与用户协商。'
