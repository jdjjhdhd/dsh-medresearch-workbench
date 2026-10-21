@echo off
chcp 65001 >nul
title 医学研究工作台 · 后台服务
cd /d "%~dp0"
echo.
echo  正在检查/启动医学研究工作台后台服务...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-bridge.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo  启动失败，错误码 %RC%。请查看上面的提示。
  pause
  exit /b %RC%
)
echo  服务已在后台运行；本窗口可以关闭。
timeout /t 3 >nul
exit /b 0
