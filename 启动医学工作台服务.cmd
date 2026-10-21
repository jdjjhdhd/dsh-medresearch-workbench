@echo off
chcp 65001 >nul
title 医学研究工作台 · 本地服务
cd /d "%~dp0"
echo.
echo  正在启动医学研究工作台本地服务...
echo  关闭此窗口即停止服务。
echo.
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$c.Connect('127.0.0.1',8765);exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
  echo  服务已在运行：http://127.0.0.1:8765/health
  start "" "http://127.0.0.1:8765/health"
  pause
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
  ) else (
    echo [错误] 未找到 node.exe，请先安装 Node.js 20+。
    pause
    exit /b 1
  )
) else (
  set "NODE=node"
)
"%NODE%" "%~dp0bridge\server.mjs"
echo.
echo  服务已停止（退出码 %ERRORLEVEL%）。
pause