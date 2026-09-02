@echo off
chcp 65001 >nul
title 婚禮系統 - 停止
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
pause
