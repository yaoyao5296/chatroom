#!/usr/bin/env python3
"""Netlify 部署：通过 ZIP 一次性上传（最简单稳定）"""
import json, subprocess, time, os

TOKEN   = "nfc_sXKkYE8NeAQffNuVa5fFX5M7Fg7Xsxzpf23e"
API     = "https://api.netlify.com/api/v1"
SITE_ID = "6ec32d48-539c-404e-a4fe-743d08843850"
ZIP     = "/tmp/chatroom-netlify.zip"
HDR     = f"Authorization: Bearer {TOKEN}"

def curl(args, timeout=600):
    r = subprocess.run(["curl","-sS","--max-time",str(timeout),*args], capture_output=True)
    if r.returncode != 0:
        print(f"  [curl rc={r.returncode}] stderr={r.stderr.decode()[:400]}")
    return r

# ========== Step 0: 打包 netlify-public/ + public/wake.html + public/404.html + netlify.toml 为 ZIP ==========
import shutil
print("===== [0/2] 打包 ZIP =====")
if os.path.exists(ZIP):
    os.remove(ZIP)
# 打包 netlify-public 内容到 ZIP 根目录 + netlify.toml
zip_base = "/tmp/chatroom-netlify-zip"
if os.path.exists(zip_base):
    shutil.rmtree(zip_base)
os.makedirs(zip_base)
# 直接把 netlify-public 里的文件复制到 ZIP 根目录（不带子目录）
if os.path.isdir("/workspace/netlify-public"):
    for f in os.listdir("/workspace/netlify-public"):
        src = os.path.join("/workspace/netlify-public", f)
        if os.path.isfile(src):
            shutil.copy(src, os.path.join(zip_base, f))
# 复制 netlify.toml
if os.path.isfile("/workspace/netlify.toml"):
    shutil.copy("/workspace/netlify.toml", f"{zip_base}/netlify.toml")
print(f"  打包目录：{zip_base}")
# 用 zip 命令打包
subprocess.run(["zip", "-r", ZIP, "."], cwd=zip_base, check=True, capture_output=True)
print(f"  ZIP 大小：{os.path.getsize(ZIP)/1024/1024:.2f} MB")

# ========== Step 1: POST ZIP as deploy (title=production) ==========
print("===== [1/2] 上传 ZIP 触发部署（deploy-by-zip，单请求搞定）=====")
print(f"  ZIP: {ZIP}")
import os
print(f"  ZIP 大小：{os.path.getsize(ZIP)/1024/1024:.2f} MB")
r = curl([
    "-X", "POST",
    "-H", HDR,
    "-H", "Content-Type: application/zip",
    "--data-binary", f"@{ZIP}",
    f"{API}/sites/{SITE_ID}/deploys?create_netlify_apps=true",
], timeout=900)
raw = r.stdout.decode()
print(f"  HTTP body 长度：{len(raw)} 字节")
try:
    deploy = json.loads(raw)
except Exception as e:
    print("❌ 返回不是 JSON：", raw[:600])
    raise SystemExit(2)

with open("/tmp/netlify-deploy.json", "w") as f:
    json.dump(deploy, f, indent=2)
deploy_id = deploy.get("id")
state = deploy.get("state")
print(f"  deploy_id = {deploy_id}")
print(f"  state     = {state}")
print(f"  deploy_url= {deploy.get('deploy_url')}")
print(f"  error_msg = {deploy.get('error_message')}")
if not deploy_id:
    print("❌ 创建 deploy 失败：", json.dumps(deploy, ensure_ascii=False)[:600])
    raise SystemExit(2)

# ========== Step 2: wait ready ==========
print("")
print("===== [2/2] 等待 deploy 就绪（最长300秒，每5秒查一次）=====")
for attempt in range(1, 61):
    r = curl(["-H", HDR, f"{API}/sites/{SITE_ID}/deploys/{deploy_id}"], timeout=60)
    d = json.loads(r.stdout.decode())
    s = d.get("state", "?")
    err = d.get("error_message")
    req_raw = d.get("required") or []
    remain = len(req_raw) if isinstance(req_raw, list) else -1
    print(f"  [{attempt:02d}/60] state={s:12s}  required剩余={remain:3d}  error={err}")
    if s == "ready":
        print("")
        print("✅ 部署发布成功！")
        break
    if s in ("error", "cancelled"):
        print("❌ 部署失败！")
        print("   summary =", json.dumps(d.get("summary") or {}, ensure_ascii=False))
        break
    time.sleep(5)

print("")
print("========== 最终域名 ==========")
print("  🌐  主入口 (自动唤醒): https://chatroom31425.netlify.app/")
print("  🌐  /wake 唤醒入口    : https://chatroom31425.netlify.app/wake")
print("  🩺  /health 健康检查  : https://chatroom31425.netlify.app/health")
print("  📱  /status JSON状态  : https://chatroom31425.netlify.app/status")
print("  🏠  项目后台          : https://app.netlify.com/projects/chatroom31425")
