---
title: "RFP: ChatRoom (com.chatroom.app)"
labels: RFP
assignees: ''
---

<!-- 把此文件直接粘贴到 https://gitlab.com/fdroid/rfp/-/issues 新建 issue -->

# 软件名 (必填)
- 英文名：ChatRoom
- 中文名：聊天室

# 开发者/维护者 (可选)
- yaoyao5296

# 源代码地址 (必填，公开 Git 仓库)
- https://github.com/yaoyao5296/chatroom

# 官网/项目主页/文档
- https://github.com/yaoyao5296/chatroom

# 软件简介
- 一句话：一个轻量级实时聊天 Web 应用（Vite + React + Node.js + SQLite），封装为 Android App
- 关键词：chat, realtime, websocket, room, webview, termux, ipv6

# 协议 (必填)
- MIT

# 构建状态 (必填：是否已经能在 CI 中构建出 APK)
- ✅ 可以：GitHub Actions 构建： `.github/workflows/build-apk.yml`
- ✅ 工作流：push 到 main 或 手动 workflow_dispatch → npm ci → npm run build → Capacitor sync → Gradle assembleRelease → chatroom.apk
- ✅ 产物：`app/build/outputs/apk/release/app-release.apk`（别名 `chatroom` 签名）

# Android 信息
- applicationId / 包名：`com.chatroom.app`
- versionName：1.0
- versionCode：1
- minSdk：24
- targetSdk：34
- 构建系统：Gradle (Capacitor Android)
- 依赖：AndroidX + Capacitor Android (无闭源依赖、无 GMS 非免费组件)

# 是否包含以下组件？（符合 F-Droid Inclusion Policy 才可以）
- [x] 无 Google Play Services (GMS)
- [x] 无 Firebase / Crashlytics / 非自由统计
- [x] 无广告 SDK / 付费墙 / 非自由订阅
- [x] 所有依赖都是 FLOSS 许可证
- [x] 没有 NonFreeNet（只有聊天用的自托管后端服务，用户也可自行部署）
- [x] APK 可复现构建：使用 Gradle wrapper + 确定版本的 npm 依赖

# 截图 / 图标 / feature graphic
- fastlane metadata 已放在仓库：`fastlane/metadata/android/en-US/` 与 `zh-CN/`
- 图标暂时使用系统默认图标（后续可替换）
- feature graphic / 截图待补（先用占位）

# Release Tag / 提交 (供 F-Droid build)
- 首次推荐 tag：`v1.0.0`
- 构建步骤说明：
  1. `cd <repo>`
  2. `npm ci`  （或 `npm install`）
  3. `npm run build` → 生成 `dist/`
  4. `npx cap sync android`
  5. `cd android && ./gradlew assembleRelease`
- 输出：`android/app/build/outputs/apk/release/app-release.apk`

# 后端 / 非自由网络说明 (NonFreeNet 判定)
- 本 App 前端可以连接任何自建后端（默认部署地址可在 `src/lib/api.ts` 里动态通过 `window.location` 计算）
- 用户可自行部署后端并通过 WebView URL / 内网穿透访问，不存在强制连接单一商业服务的情况

# 其它
- 当前 Termux 平板上的公网演示地址：
  - https://chatroomzjp0310.loca.lt
  - https://chatroomzjp0425.loca.lt
- 上游 Issue：如有与 F-Droid 相关的具体构建失败 / 补丁，在本 issue 跟进
