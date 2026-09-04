# 停止所有服務（資料不會遺失）
. "$PSScriptRoot\paths.ps1"

Write-Host "停止網站後端..."
# 只停「這個專案的 .venv」跑起來的 python，不會誤殺電腦上其他 python 程式
$venvPrefix = Join-Path $BACK ".venv"
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($venvPrefix, [System.StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force

Write-Host "停止 Redis..."
Get-Process redis-server -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "停止 PostgreSQL..."
if (Test-Path "$PG\pg_ctl.exe") {
    & "$PG\pg_ctl.exe" -D $DATA stop 2>&1 | Out-Null
}

Write-Host "已全部停止。" -ForegroundColor Green
Start-Sleep -Seconds 1
