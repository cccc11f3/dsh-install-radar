# 把本地仓库推到 GitHub（不需要你把 token 交给我）：
#   1. 先在浏览器里建一个空仓库：https://github.com/new  （名字 dsh-install-radar，不要勾 README/.gitignore）
#   2. 然后运行：
#        pwsh -File publish\push-to-github.ps1 -Owner <你的GitHub用户名>
#
# 首次推送会弹出 GitHub 登录窗口（Git Credential Manager），登录一次之后就不用再登。
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = 'dsh-install-radar',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path (Join-Path $root '.git'))) {
  Write-Host "还不是 git 仓库，先初始化 …" -ForegroundColor Yellow
  git init -b $Branch
  git add -A
  git commit -m "feat: dsh-install-radar 1.0.0"
}

$url = "https://github.com/$Owner/$Repo.git"
$existing = (git remote 2>$null) -contains 'origin'
if ($existing) { git remote set-url origin $url } else { git remote add origin $url }
Write-Host "remote origin -> $url" -ForegroundColor Cyan

# 探测远端是否可访问（需要你在 GitHub 上已经建好这个空仓库）
git ls-remote --exit-code --heads origin 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "远端还不可用。请先在浏览器里建空仓库：" -ForegroundColor Yellow
  Write-Host "  https://github.com/new  仓库名：$Repo   不要勾 README / .gitignore / license" -ForegroundColor Yellow
  Write-Host "建好后重跑本脚本。" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "推送中（如果弹出登录窗口，选『在浏览器中登录』即可）…" -ForegroundColor Cyan
git push -u origin $Branch
if ($LASTEXITCODE -ne 0) { Write-Host "推送失败，退出码 $LASTEXITCODE" -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host ""
Write-Host "完成：https://github.com/$Owner/$Repo" -ForegroundColor Green
Write-Host ""
Write-Host "下一步（二选一）：" -ForegroundColor Cyan
Write-Host "  · 提市场 PR：node publish\market-pr.mjs --user $Owner --repo $Repo" -ForegroundColor Cyan
Write-Host "  · 发 npm    ：pwsh -File publish\npm-publish.ps1" -ForegroundColor Cyan
