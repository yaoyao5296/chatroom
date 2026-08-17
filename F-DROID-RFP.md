# F-Droid RFP (Request for Packaging)
# Repository: https://gitlab.com/fdroid/rfp/-/issues
# 提交标题请使用：RFP: com.chatroom.app

---
name: Request for Packaging (RFP)
about: 申请将 ChatRoom 打包加入 F-Droid 官方仓库
title: "RFP: com.chatroom.app"
labels: needs-triaging
assignees: ''

---

<!--
  请按 F-Droid RFP 模板填写。提交地址：
  https://gitlab.com/fdroid/rfp/-/issues/new?issuable_template=Request-for-Packaging
-->

## 应用基本信息

- **应用名（AutoName）**：ChatRoom
- **Android 包名（ApplicationId）**：`com.chatroom.app`
- **上游仓库（Source Code URL）**：https://github.com/yaoyao5296/chatroom
- **问题跟踪**：https://github.com/yaoyao5296/chatroom/issues
- **网站 / 文档**：https://github.com/yaoyao5296/chatroom
- **License**：MIT
- **当前版本（versionName）**：1.0
- **当前版本号（versionCode）**：1

## 类别（Categories）

- `Internet`
- `Connectivity`

## 功能简介（Short Description）

轻量级自托管实时聊天应用 — 公/私聊天、朋友圈、好友列表、图片/文件上传，WebSocket 全双工通信，支持 IPv4/IPv6，无第三方服务器强制依赖，无 Google Play Services，无广告。

## 详细描述（Full Description）

ChatRoom 是一个轻量级、可自托管的实时聊天 Web + Android 应用（通过 Capacitor 打包）。
后端为 Node.js + SQLite，前端为 SvelteKit + WebSocket。整个应用免费、开源、无广告、不依赖任何强制第三方服务。

### 主要特性

* **实时消息（WebSocket）**：发送/接收即时消息，多人在线状态同步
* **公共聊天室**：多人开放式群组对话
* **私信 (DM)**：点对点加密传输式直接对话
* **朋友圈 / 动态时间线**：分享图片与文字动态
* **好友管理**：添加/移除好友，在线/离线状态指示器
* **文件与图片上传**：聊天中发送图片和任意文件附件
* **双栈网络**：服务端可同时运行在 IPv4 与 IPv6 环境下
* **自托管后端**：用户可自行部署 Node.js + SQLite 服务器（Termux / VPS / 本地均可）
* **无强制第三方服务依赖**：不需要 Google Play Services，不强制集成 GMS
* **无广告、无追踪**：MIT 协议开源

## 是否包含专有组件 / 反特性？（Anti-Features）

- **Ads** ❌ No
- **Tracking** ❌ No
- **Non-Free Addons** ❌ No
- **Non-Free Dependencies** ❌ No
- **Non-Free Assets** ❌ No
- **Upstream Non-Free** ❌ No
- **Known Vulnerabilities** ❌ No
- **Disabled Algorithm** ❌ No

本应用由 Capacitor 打包的纯开源 Web 应用，未集成任何闭源 SDK 或广告/追踪 SDK。

## 构建方法（建议的 metadata/build 段）

> 仓库根目录下已包含参考版本：
>   - `metadata/com.chatroom.app.yml`（F-Droid 风格 YAML 模板）
>   - `fastlane/metadata/android/en-US/`（Fastlane 元数据：title.txt、short_description.txt、full_description.txt、changelogs/）

关键构建步骤如下，已在 CI（GitHub Actions）上验证可构建：

```yaml
RepoType: git
Repo: https://github.com/yaoyao5296/chatroom.git

Builds:
  - versionName: '1.0'
    versionCode: 1
    commit: v1.0.0
    subdir: android
    sudo:
      - apt-get update || apt-get update
      - apt-get install -y ca-certificates curl gnupg
      - mkdir -p /etc/apt/keyrings
      - curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
      - echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
      - apt-get update
      - apt-get install -y nodejs
      - node -v && npm -v
    init: |
        cd ..
        npm ci --no-audit --no-fund || npm install --no-audit --no-fund
        npm run build
        npx cap sync android
    gradle:
      - yes

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: '1.0'
CurrentVersionCode: 1
```

### 构建依赖要点（已在实际 CI 中验证）

1. **Node.js ≥ 22**：`@capacitor/cli` 对 Node 版本有要求；`npm ci / npm run build` 用于构建前端静态资源到 `dist/`。
2. **JDK ≥ 21**：`@capacitor/android:v8` 在 `compileReleaseJavaWithJavac` 阶段使用 `sourceCompatibility = 21`。
3. **Android Gradle Plugin ≥ 8.9.1**：
   * 根 `android/build.gradle` 需要 `apply from: "variables.gradle"`；
   * 且 classpath 必须为 `com.android.tools.build:gradle:8.9.1` 或更高（`androidx.core:core:1.17.0` / `androidx.activity:activity-ktx:1.11.0` 的 AAR metadata 要求 AGP ≥ 8.9.1）。
   * 仓库中 `android/variables.gradle` 定义了 `minSdkVersion / compileSdkVersion / targetSdkVersion`。
4. 签名：F-Droid 构建流程会自动替换为官方签名密钥；CI 中使用的自定义签名信息仅用于 Release 验证，F-Droid 可忽略。

## Fastlane 元数据（已包含在仓库）

```
fastlane/metadata/android/en-US/
├── title.txt               # "ChatRoom"
├── short_description.txt   # "Self-hosted real-time chat app via Capacitor"
├── full_description.txt    # 完整特性列表（见上）
├── video.txt               # (空，可选)
└── changelogs/
    └── 1.txt               # 1.0 版本变更日志
```

## 上游二进制 APK（参考下载，用于包名与内容核对）

- GitHub Actions Artifact（Run #110 / #111）：
  * https://github.com/yaoyao5296/chatroom/actions/runs/32010218012
- APK 校验（SHA-256）：
  * `9fdb3f034bb7f3b12a711c6ceb4545b3d5c42042eba60fa6d91084c8f4dad6ba  chatroom.apk`
- APK 大小：~16 MB
- 支持的 ABI：arm64-v8a, armeabi-v7a, x86, x86_64

## 上游源代码构建状态（CI 通过）

已在 GitHub Actions `build-apk.yml`（`ubuntu-latest`）上验证以下 13 步全绿：

1. ✅ Checkout
2. ✅ Node 22
3. ✅ npm ci + build 前端 dist
4. ✅ Setup Java 21 (Temurin)
5. ✅ Setup Gradle Wrapper
6. ✅ 写入 keystore + keystore.properties（F-Droid 可替换）
7. ✅ 安装 Capacitor + `npx cap sync android`
8. ✅ 根 build.gradle 补丁（`apply variables.gradle` + AGP 8.9.1 classpath）
9. ✅ Gradle `assembleRelease`（签名版 APK 成功产出）
10. ✅ 重命名 → `chatroom.apk`
11. ✅ Artifact 上传 `chatroom-signed-apk`

CI Workflow 文件路径：`.github/workflows/build-apk.yml`（已随仓库提交，可供参考）。

## 待办（F-Droid 侧 RFP checklist 提交前可由打包者确认）

- [x] 源码 URL 可达，仓库为公开 Git
- [x] 存在 LICENSE 文件（MIT）
- [x] AndroidManifest 中声明了 `applicationId = com.chatroom.app`
- [x] Fastlane / Triple-T 元数据存在
- [x] 可在干净环境下，通过 Node 22 + JDK 21 + Gradle + Capacitor 构建
- [x] 未包含已知的 Anti-Features（广告 / 追踪 / 闭源 SDK / 非自由 assets 等）
- [x] 没有 pre-built `.so` 二进制来自闭源；所有 AAR 依赖来自 google() / mavenCentral()
- [x] 应用不强制要求 Google Play Services、GMS 或 Firebase
