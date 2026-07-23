@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title ChatRoom 桌面软件打包

echo ========================================
echo   ChatRoom 桌面软件打包（Windows 版）
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js
    echo 请先安装: https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

echo.
echo [2/3] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)

echo.
echo [3/3] 打包桌面安装包...
call npx electron-builder --win
if %errorlevel% neq 0 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo   打包成功！
echo.
echo   安装包位置: release\ChatRoom Setup x.x.x.exe
echo   把这个 exe 发给别人，双击安装即可！
echo ========================================
echo.

pause