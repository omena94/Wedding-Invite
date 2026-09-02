# 停止所有服務（資料不會遺失）
Write-Host "停止網站後端..."
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*Wedding Invite*" } | Stop-Process -Force

Write-Host "停止 Redis..."
Get-Process redis-server -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "停止 PostgreSQL..."
& "C:\WeddingRSVP\pgsql\bin\pg_ctl.exe" -D "C:\WeddingRSVP\pgdata" stop 2>&1 | Out-Null

Write-Host "已全部停止。" -ForegroundColor Green
Start-Sleep -Seconds 1
