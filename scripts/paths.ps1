# 共用設定：由 start.ps1 / stop.ps1 以 dot-source 載入（. "$PSScriptRoot\paths.ps1"）
#
# 本機資料庫引擎（pgsql\ 、redis\ 、pgdata\ ）放在「本機資料目錄」，與專案分開，
# 才不會因為專案路徑含中文或空白讓 PostgreSQL 出問題。位置依序決定：
#   1. 環境變數 WEDDING_RSVP_HOME（想放別的地方就設這個）
#   2. C:\WeddingRSVP（舊版預設位置；已經照舊說明裝好的電腦不用改任何東西）
#   3. %LOCALAPPDATA%\WeddingRSVP（以上都沒有時的預設）

$APP  = Split-Path $PSScriptRoot -Parent        # 專案根目錄
$BACK = Join-Path $APP "backend"

if ($env:WEDDING_RSVP_HOME) {
    $RSVP_HOME = $env:WEDDING_RSVP_HOME
} elseif (Test-Path "C:\WeddingRSVP") {
    $RSVP_HOME = "C:\WeddingRSVP"
} else {
    $RSVP_HOME = Join-Path $env:LOCALAPPDATA "WeddingRSVP"
}

$PG    = Join-Path $RSVP_HOME "pgsql\bin"
$DATA  = Join-Path $RSVP_HOME "pgdata"
$REDIS = Join-Path $RSVP_HOME "redis"
$PGLOG = Join-Path $RSVP_HOME "pg.log"
$PYTHON = Join-Path $BACK ".venv\Scripts\python.exe"
