@echo off
chcp 65001 >nul
title R3 漫剧自动化 Web 控制台
cd /d "%~dp0"

echo ============================================================
echo   R3 漫剧自动化系统 (企业发布版)
echo   正在启动本地 Web 控制台服务，请稍候...
echo ============================================================
echo.

if not exist "node\node.exe" (
    echo [错误] 未检测到内置运行环境: node\node.exe
    echo 请确认项目目录完整或重新下载。
    echo.
    pause
    exit /b 1
)

if not exist "src\web\main.ts" (
    echo [错误] 未检测到入口文件: src\web\main.ts
    echo 请确认发布包完整。
    echo.
    pause
    exit /b 1
)

"node\node.exe" "src\web\main.ts"

if %errorlevel% neq 0 (
    echo.
    echo ============================================================
    echo [提示] 服务已停止 (退出码: %errorlevel%)
    echo 若启动异常，请检查上方报错或查看 data\ 目录下的日志文件。
    echo ============================================================
    echo 按任意键退出...
    pause >nul
)
