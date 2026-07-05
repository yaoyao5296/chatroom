@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title ChatRoom APK 打包

echo ========================================
echo   ChatRoom 手机软件打包
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

:: 检查 Java
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Java
    echo 请安装 Java 17: https://adoptium.net
    pause
    exit /b 1
)

:: 检查 Android SDK
if "%ANDROID_HOME%"=="" (
    if "%ANDROID_SDK_ROOT%"=="" (
        echo [提示] 未检测到 ANDROID_HOME 环境变量
        echo.
        echo 打包 APK 需要 Android SDK，推荐安装 Android Studio:
        echo   https://developer.android.com/studio
        echo.
        echo 或者安装命令行工具:
        echo   https://developer.android.com/studio#command-line-tools-only
        echo.
        echo 安装后请设置环境变量 ANDROID_HOME 指向 SDK 目录
        echo 例如: set ANDROID_HOME=C:\Users\你的用户名\AppData\Local\Android\Sdk
        echo.
        set /p CONTINUE="如果已安装但未设置环境变量，请输入 SDK 路径后回车（直接回车跳过）: "
        if not "!CONTINUE!"=="" (
            set ANDROID_HOME=!CONTINUE!
        ) else (
            echo [跳过] 未配置 Android SDK，无法打包 APK
            pause
            exit /b 1
        )
    )
)

echo.
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
echo [3/3] 打包 APK...
call npx cap sync android
if %errorlevel% neq 0 (
    echo [错误] Capacitor 同步失败
    pause
    exit /b 1
)

:: 使用 Gradle 构建 APK
cd android
call gradlew assembleDebug
if %errorlevel% neq 0 (
    echo.
    echo [错误] APK 打包失败
    echo 请确保已安装 Android SDK 并正确配置 ANDROID_HOME
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo   打包成功！
echo.
echo   APK 文件位置:
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo   把这个 APK 文件传到手机上安装即可
echo ========================================
echo.
echo 手机安装后，打开软件 → 设置 → 服务器地址
echo 输入你电脑的 IP:3001，例如:
echo   http://192.168.1.100:3001
echo.

pause