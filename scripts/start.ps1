# 一鍵啟動：PostgreSQL + Redis + 網站後端（單一 port 8000）
$ErrorActionPreference = "Stop"
$PG    = "C:\WeddingRSVP\pgsql\bin"
$DATA  = "C:\WeddingRSVP\pgdata"
$REDIS = "C:\WeddingRSVP\redis"
$APP   = Split-Path $PSScriptRoot -Parent   # 專案根目錄
$BACK  = Join-Path $APP "backend"

Write-Host "檢查資料庫服務..." -ForegroundColor Cyan

# 1) PostgreSQL
& "$PG\pg_ctl.exe" -D $DATA status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  啟動 PostgreSQL..."
    & "$PG\pg_ctl.exe" -D $DATA -l "C:\WeddingRSVP\pg.log" -o "-p 5432" start | Out-Null
    Start-Sleep -Seconds 3
} else { Write-Host "  PostgreSQL 已在執行" -ForegroundColor Green }

# 2) Redis
$pong = ""
try { $pong = & "$REDIS\redis-cli.exe" ping 2>$null } catch {}
if ($pong -ne "PONG") {
    Write-Host "  啟動 Redis..."
    Start-Process "$REDIS\redis-server.exe" -ArgumentList "$REDIS\redis.windows.conf" -WindowStyle Hidden
    Start-Sleep -Seconds 2
} else { Write-Host "  Redis 已在執行" -ForegroundColor Green }

# 3) 後端（同時提供前端）
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "====================================================" -ForegroundColor Yellow
Write-Host "  婚禮系統啟動中！用瀏覽器開啟：" -ForegroundColor Yellow
Write-Host "    出席表單：  http://localhost:8000/"
Write-Host "    後台管理：  http://localhost:8000/admin"
if ($ip) {
Write-Host "    手機同 WiFi 可連： http://${ip}:8000/"
}
Write-Host ""
Write-Host "  關閉這個視窗 = 停止網站（資料不會遺失）" -ForegroundColor DarkGray
Write-Host "====================================================" -ForegroundColor Yellow
Start-Process "http://localhost:8000/"

Set-Location $BACK
& "$BACK\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
