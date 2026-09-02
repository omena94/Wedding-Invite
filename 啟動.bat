@echo off
chcp 65001 >nul
title 婚禮系統 - 啟動中
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
echo.
echo （若上面出現錯誤，把畫面截圖給工程師看）
pause
