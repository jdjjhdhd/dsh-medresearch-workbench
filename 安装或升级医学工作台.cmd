@echo off
chcp 65001 >nul
title 医学工作台 - 安装或升级
cd /d "%~dp0"
set "MEDWB_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "MEDWB_NODE=C:\Program Files\nodejs\node.exe"
  ) else (
    echo [错误] 未找到 Node.js。请安装 Node.js 20+ 后重试。
    pause
    exit /b 1
  )
)
"%MEDWB_NODE%" "%~dp0scripts\install-model-plugin.mjs"
set "MEDWB_RC=%ERRORLEVEL%"
echo.
if not "%MEDWB_RC%"=="0" (
  echo [错误] 安装未完成，退出码 %MEDWB_RC%。请保留上面的错误提示。
  pause
  exit /b %MEDWB_RC%
)
echo [完成] 请完全退出并重新打开 DeepSeek Harness。
echo 请保留本交付目录。更换目录后，在新位置重新运行本安装入口。
pause
exit /b 0
