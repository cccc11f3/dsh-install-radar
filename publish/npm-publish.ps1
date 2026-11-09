# 发布到 npm（官方源）。用法：
#   pwsh -File publish\npm-publish.ps1
#   pwsh -File publish\npm-publish.ps1 -Registry https://registry.npmjs.org
param(
  [string]$Registry = 'https://registry.npmjs.org'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
Write-Host "包名  : $($pkg.name)" -ForegroundColor Cyan
Write-Host "版本  : $($pkg.version)" -ForegroundColor Cyan
Write-Host "源    : $Registry" -ForegroundColor Cyan

# 1) 登录检查
$who = $null
try { $who = (npm whoami --registry $Registry 2>$null) } catch { $who = $null }
if (-not $who) {
  Write-Host ""
  Write-Host "还没登录 $Registry。" -ForegroundColor Yellow
  Write-Host "先执行其中一个：" -ForegroundColor Yellow
  Write-Host "  npm login --registry=$Registry" -ForegroundColor Yellow
  Write-Host "  `$env:NPM_TOKEN='npm_xxx'   # 然后重跑本脚本" -ForegroundColor Yellow
  if ($env:NPM_TOKEN) {
    Write-Host "检测到 NPM_TOKEN，尝试用 token 生成临时 .npmrc …" -ForegroundColor Yellow
    $npmrc = Join-Path $root '.npmrc.publish'
    "//registry.npmjs.org/:_authToken=$env:NPM_TOKEN" | Set-Content -Path $npmrc -Encoding ascii
    $env:npm_config_userconfig = $npmrc
    $who = (npm whoami --registry $Registry 2>$null)
    if (-not $who) { Write-Host "token 无效，终止。" -ForegroundColor Red; exit 1 }
  } else {
    exit 1
  }
}
Write-Host "已登录：$who" -ForegroundColor Green

# 2) 名字占用检查
try {
  $existing = Invoke-RestMethod "https://registry.npmjs.org/$($pkg.name)" -TimeoutSec 20
  $owner = $existing.maintainers | ForEach-Object { $_.name }
  if ($owner -notcontains $who) {
    Write-Host "包名 $($pkg.name) 已被 $($owner -join ', ') 占用，终止。" -ForegroundColor Red
    exit 1
  }
  Write-Host "包已存在且属于你，将发布 $($pkg.version)（同名版本会 403）" -ForegroundColor Yellow
} catch {
  Write-Host "包名可用（首次发布）" -ForegroundColor Green
}

# 3) 打包预览 + 发布
Write-Host ""
Write-Host "== npm pack（预览） ==" -ForegroundColor Cyan
npm pack --dry-run 2>&1 | Select-Object -Last 8

Write-Host ""
Write-Host "== npm publish ==" -ForegroundColor Cyan
npm publish --registry $Registry
if ($LASTEXITCODE -ne 0) { Write-Host "发布失败，退出码 $LASTEXITCODE" -ForegroundColor Red; exit $LASTEXITCODE }

# 4) 回查
Start-Sleep -Seconds 2
$live = (npm view $pkg.name version --registry $Registry 2>$null)
Write-Host ""
Write-Host "线上版本：$live" -ForegroundColor Green
Write-Host "安装命令：dsh plugin --profile desktop add $($pkg.name)" -ForegroundColor Green
Write-Host "页面    ：https://www.npmjs.com/package/$($pkg.name)" -ForegroundColor Green
