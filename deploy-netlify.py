#!/usr/bin/env python3
"""Netlify 部署脚本（不静默，全部打印进度）"""
import os, hashlib, json, subprocess, sys, time
import concurrent.futures as cf

TOKEN    = "nfc_sXKkYE8NeAQffNuVa5fFX5M7Fg7Xsxzpf23e"
API      = "https://api.netlify.com/api/v1"
SITE_ID  = "6ec32d48-539c-404e-a4fe-743d08843850"
ROOT     = "/tmp/netlify-deploy"
HDR      = f"Authorization: Bearer {TOKEN}"

def curl(args, timeout=60):
    r = subprocess.run(["curl","-sS","--max-time",str(timeout),*args], capture_output=True)
    return r

def curl_json(args, timeout=60):
    r = curl(["-H", HDR, *args], timeout=timeout)
    try:
        return json.loads(r.stdout.decode()), r.returncode
    except Exception as e:
        return {"_raw": r.stdout.decode()[:300], "_err": str(e)}, r.returncode

# ============ Step 3: manifest ============
print("===== [3/6] 计算所有文件 SHA1 =====")
files = {}
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, ROOT)
        if rel.startswith("./"):
            rel = rel[2:]
        npath = "/" + rel
        h = hashlib.sha1()
        with open(p, "rb") as fh:
            while True:
                c = fh.read(1 << 20)
                if not c:
                    break
                h.update(c)
        files[npath] = {"sha": h.hexdigest(), "size": os.path.getsize(p)}
print(f"  总文件数：{len(files)}")
manifest = {"files": files}
with open("/tmp/netlify-files.json", "w") as f:
    json.dump(manifest, f)
print("  manifest 写入完成")

# ============ Step 4: create deploy ============
print("")
print("===== [4/6] 创建 deploy =====")
r = curl([
    "-X", "POST", "-H", HDR, "-H", "Content-Type: application/json",
    "--data-binary", "@/tmp/netlify-files.json",
    f"{API}/sites/{SITE_ID}/deploys",
], timeout=120)
deploy = json.loads(r.stdout.decode())
with open("/tmp/netlify-deploy.json", "w") as f:
    json.dump(deploy, f)
deploy_id = deploy.get("id")
state = deploy.get("state")
required = deploy.get("required", []) or []
print(f"  deploy_id = {deploy_id}")
print(f"  state    = {state}")
print(f"  required = {len(required)} 个 sha")
if required:
    print(f"    前3个: {required[:3]}")
if not deploy_id:
    print("❌ deploy 创建失败:", json.dumps(deploy, ensure_ascii=False)[:600])
    sys.exit(2)

# ============ Step 5: upload ============
print("")
print("===== [5/6] 上传文件（并发8线程）=====")
sha_to_path = {}
for npath, m in files.items():
    sha_to_path[m["sha"]] = os.path.join(ROOT, npath.lstrip("/"))

def upload_one(sha):
    p = sha_to_path.get(sha)
    if not p or not os.path.exists(p):
        return (sha, False, "missing")
    url = f"{API}/deploys/{deploy_id}/files/{sha}"
    r = curl([
        "-X", "PUT", "-H", HDR, "-H", "Content-Type: application/octet-stream",
        "--data-binary", f"@{p}", "-o", "/dev/null", "-w", "%{http_code}", url,
    ], timeout=180)
    code = r.stdout.decode().strip() or "000"
    return (sha, code in ("200","201","202"), code)

todo = []
for item in required:
    # 兼容两种格式：item 可能是字符串 sha，也可能是 dict {"sha":..., "size":...}
    if isinstance(item, dict):
        s = item.get("sha", "")
    else:
        s = item
    if s and s in sha_to_path:
        todo.append(s)
print(f"  待上传 {len(todo)} 个（required {len(required)} 个）")

ok_n = fail_n = 0
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    for i, (sha, ok, code) in enumerate(ex.map(upload_one, todo), 1):
        if ok:
            ok_n += 1
        else:
            fail_n += 1
            print(f"    失败 sha={sha[:8]}... code={code}")
        if i % 10 == 0 or i == len(todo):
            print(f"    进度 {i}/{len(todo)} — 成功 {ok_n}，失败 {fail_n}")
print(f"  上传完成：成功 {ok_n}，失败 {fail_n}")

# ============ Step 6: wait ready ============
print("")
print("===== [6/6] 等待 deploy ready（最长120秒）=====")
for attempt in range(1, 25):
    d, rc = curl_json([f"{API}/sites/{SITE_ID}/deploys/{deploy_id}"])
    s = d.get("state", "?")
    err = d.get("error_message")
    req_raw = d.get("required", []) or []
    remain = len(req_raw) if isinstance(req_raw, list) else 0
    print(f"  [{attempt:02d}/24] state={s}  required剩余={remain}  error={err}")
    if s == "ready":
        print("✅ 发布完成！")
        break
    if s in ("error","cancelled") and err:
        print("❌ 出错了")
        break
    time.sleep(5)

print("")
print("========== 部署结果总结 ==========")
print(f"  域名（HTTPS）: https://chatroom31425.netlify.app")
print(f"  /wake 入口   : https://chatroom31425.netlify.app/wake")
print(f"  /health 检查 : https://chatroom31425.netlify.app/health")
print(f"  项目后台      : https://app.netlify.com/projects/chatroom31425")
