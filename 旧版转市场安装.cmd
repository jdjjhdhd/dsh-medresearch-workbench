@echo off
setlocal
chcp 65001 >nul
title 医学工作台 - 旧版转市场安装
set "MEDWB_SYSTEM_NODE="
for /f "delims=" %%N in ('where.exe "$PATH:node.exe" 2^>nul') do if not defined MEDWB_SYSTEM_NODE set "MEDWB_SYSTEM_NODE=%%N"
if not defined MEDWB_SYSTEM_NODE (
  echo [错误] PATH 中未找到系统 Node.js。请安装 Node.js 20+ 后重试。
  pause
  exit /b 1
)
"%MEDWB_SYSTEM_NODE%" "%~dp0scripts\prepare-market-install.mjs" %*
set "MEDWB_RC=%ERRORLEVEL%"
echo.
if not "%MEDWB_RC%"=="0" (
  echo [错误] 未完成迁移准备，退出码 %MEDWB_RC%。请保留上面的错误提示。
)
pause
exit /b %MEDWB_RC%
