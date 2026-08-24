# F-Droid 发布 · 本地执行步骤

## A. 先把下面 3 个文件提交到 GitHub (yaoyao5296/chatroom)

仓库： https://github.com/yaoyao5296/chatroom
分支： main 或 master

**要新增/修改的路径：**


如果 `android/` 目录目前不完整也没关系，GitHub Actions 会执行 `npx cap add android` 自动生成 android/。
但建议把本地完整的 `android/` 也一起提交（这样 F-Droid build 更稳）。

---

## B. 配置 GitHub Repository Secrets

打开： https://github.com/yaoyao5296/chatroom/settings/secrets/actions

添加 3 个 Secrets（**可选**，不配也能跑，CI 会自动生成临时 keystore）：

| Secret 名                | 值                                              |
| ------------------------ | ----------------------------------------------- |
| `CHATROOM_KEYSTORE_B64`  | Termux 执行 `base64 -w0 ~/chatroom/chatroom-release.keystore` 的输出 |
| `KEYSTORE_PASSWORD`      | `Zjp120310`                                     |
| `KEY_PASSWORD`           | `Zjp120310`                                     |

> **为什么可选？** 因为 F-Droid 收录时会用 F-Droid 自己的 key 重新签名，你自己的 key 只用于 GitHub Actions 出的测试包和 RFP 时提交的证明包。

---

## C. 触发 GitHub Actions 构建 chatroom.apk

打开： https://github.com/yaoyao5296/chatroom/actions/workflows/build-apk.yml

- 方式 1：在页面点 `Run workflow`（workflow_dispatch）
- 方式 2：本地 `git push origin main` 自动触发
- 方式 3：打 tag `v1.0.0` 推送 → 自动创建 GitHub Release 并把 `chatroom.apk` 挂上去

```bash
cd ~/chatroom
git tag -a v1.0.0 -m "v1.0.0: First F-Droid release"
git push origin v1.0.0
```

10-20 分钟后：
- **Artifacts** 页面下载 `chatroom-signed-apk` → 解压得 `chatroom.apk`
- 打 tag 的话 **Releases** 页面直接有 `chatroom.apk`

---

## D. 提交 F-Droid RFP (Request for Packaging)

F-Droid 的收录流程（2025 年）是在 GitLab 提 Issue：

1. 打开： https://gitlab.com/fdroid/rfp/-/issues/new
2. 用 GitHub 或 GitLab 账号登录
3. 标题填： `RFP: ChatRoom (com.chatroom.app)`
4. 内容复制本仓库 `F-DROID-RFP-ISSUE.md` 的全文粘贴进去
5. 提交 Issue，然后：
   - 把刚刚 GitHub Actions 构建出来的 `chatroom.apk` 下载链接 / Release 链接贴到 Issue
   - F-Droid 维护者会验证软件是否满足 Inclusion Policy（无 GMS、无广告、无 NonFreeNet 闭源网络服务等）
   - 通过后会创建一个 Merge Request 到 fdroiddata（metadata YAML），进入构建队列

---

## E. F-Droid metadata/com.chatroom.app.yml（提交 fdroiddata 时用）

参考 `fastlane/metadata/android/yaml-preview.txt`，标准格式：

```yaml
Categories:
  - Internet
  - Connectivity
License: MIT
WebSite: https://github.com/yaoyao5296/chatroom
SourceCode: https://github.com/yaoyao5296/chatroom
IssueTracker: https://github.com/yaoyao5296/chatroom/issues
Summary: A lightweight real-time chat web app.
Description: |-
    ChatRoom is a lightweight, real-time chat web application packaged as an Android app.
    It supports live messaging, public chat rooms, and works over both IPv4 and IPv6.
    RepoType: git
Repo: https://github.com/yaoyao5296/chatroom
Builds:
  - versionName: 1.0
    versionCode: 1
    commit: v1.0.0
    subdir: android
    sudo:
      - apt-get update
      - apt-get install -y npm nodejs
    init: |
        cd ..
        npm ci || npm install
        npm run build
        npx cap sync android
    gradle:
      - yes
AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: 1.0
CurrentVersionCode: 1
```

---

## F. 常见坑（提前规避）

1. **不要提交 keystore 文件到 git**：`chatroom-release.keystore` 一定加到 `.gitignore`
2. **所有依赖必须是 FLOSS**：Capacitor/AndroidX 都是 OK 的，不要加 Firebase / GMS / bugly / Umeng
3. **Non-Free Network**：F-Droid 对必须连某个商业后端的 App 会打 AntiFeatures，ChatRoom 默认是自托管后端，不构成问题，但如果默认内置了固定单一商业服务会被标 NonFreeNet
4. **版本号单调递增**：每次发布 F-Droid 更新时 `versionCode` 必须 +1
5. **fastlane 元数据中的截图尺寸**：phoneScreenshots 建议 1080×1920 或 1080×2400，featureGraphic 1024×500
