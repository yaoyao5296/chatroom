#!/usr/bin/env python3
"""gh codespace ssh 重试启动 chatroom + bore 隧道（非后台交互方式，单次命令串行执行）"""
import subprocess, time, sys, os

CS = "chatroom-qvqrr4p54q7jh46r6"

def cs_ssh(cmd, retries=5, wait=6, timeout=120):
    """通过 gh codespace ssh 跑一条命令，带重试"""
    full_cmd = ["gh","codespace","ssh","-c",CS,"--server-port","0","--",cmd]
    for i in range(1, retries+1):
        print(f"\n  [ssh attempt {i}/{retries}] $ {cmd[:120]}")
        env = {**os.environ, "GH_NO_UPDATE_NOTIFIER":"1"}
        try:
            r = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            print(f"    timeout {timeout}s，重试")
            time.sleep(wait)
            continue
        print(f"    rc={r.returncode}")
        if r.stdout:
            print("    stdout:")
            for line in r.stdout.splitlines()[:80]:
                print("     ", line)
        if r.stderr and ("error" in r.stderr.lower() or r.returncode != 0):
            print("    stderr:")
            for line in r.stderr.splitlines()[:30]:
                print("     ", line)
        if r.returncode == 0 and ("context deadline" not in (r.stderr or "")):
            return (r.returncode, r.stdout, r.stderr)
        time.sleep(wait)
    print("    ❌ SSH 多次失败，跳过这条命令。")
    return (None, None, None)

print("========== [1] 查 Codespace 内目录 / 启动入口 ==========")
cs_ssh("cd /workspace && pwd && ls -la && echo '--- scripts ---' && [ -f package.json ] && (cat package.json | python3 -c 'import json,sys;d=json.load(sys.stdin);print(json.dumps(d.get(\"scripts\",{}),indent=2))')")

print("\n========== [2] 清旧进程 ==========")
cs_ssh("pkill -9 -f 'bore local' 2>/dev/null; pkill -9 -f 'tsx|node server|npm run' 2>/dev/null; sleep 2; echo killed")

print("\n========== [3] 后台启动 chatroom 3001（不等待直接返回）==========")
# 关键：用 nohup + setsid + 关闭 stdin/stdout/stderr 重定向到文件，命令本身立刻退出，gh ssh 不会卡住
BOOT_CR = r"""
setsid bash -c '
  cd /workspace
  export PATH=$HOME/.local/bin:$PATH
  [ -s $HOME/.nvm/nvm.sh ] && source $HOME/.nvm/nvm.sh
  rm -f /tmp/chatroom.log
  if [ -x node_modules/.bin/tsx ]; then
    exec node_modules/.bin/tsx api/server.ts > /tmp/chatroom.log 2>&1
  elif command -v tsx >/dev/null 2>&1; then
    exec tsx api/server.ts > /tmp/chatroom.log 2>&1
  else
    exec npm run dev -- --host 0.0.0.0 --port 3001 > /tmp/chatroom.log 2>&1
  fi
' < /dev/null > /dev/null 2>&1 &
disown
echo chatroom_launched=$!
"""
rc, out, err = cs_ssh(BOOT_CR)

print("\n========== [4] 等 3001 起来 ==========")
WAIT3001 = r"""
for i in $(seq 1 25); do
  code=$(curl -sS --max-time 2 -o /tmp/crh -w "%{http_code}" http://127.0.0.1:3001/api/health 2>/dev/null || echo 000)
  echo "$i code=$code"
  if [ "$code" = "200" ]; then echo "body:"; cat /tmp/crh; echo; exit 0; fi
  sleep 2
done
echo "--- tail chatroom.log ---"; tail -30 /tmp/chatroom.log 2>/dev/null
exit 1
"""
cs_ssh(WAIT3001, retries=3, timeout=90)

print("\n========== [5] 后台起 bore 隧道 3001→bore.pub:31425 ==========")
BOOT_BORE = r"""
setsid bore local 3001 --to bore.pub --port 31425 < /dev/null > /tmp/bore.log 2>&1 &
disown
sleep 4
echo borepid=$!
echo "--- bore.log head ---"
head -20 /tmp/bore.log
echo "--- 3001 listen? ---"
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep :3001 || true
"""
cs_ssh(BOOT_BORE, timeout=30)

print("\n========== [6] 再等 10 秒，给 bore 连服务器 ==========")
time.sleep(12)

print("\n========== [7] Codespace 内自测 bore 转发是否工作 ==========")
cs_ssh("echo '--- bore.log tail ---'; tail -20 /tmp/bore.log; echo '--- curl bore 出口 ---'; curl -sS --max-time 10 -o /tmp/bore_out.html -w 'HTTP_CODE=%{http_code}\n' http://bore.pub:31425/api/health 2>&1; cat /tmp/bore_out.html 2>/dev/null; echo")

print("\n========== [本地][8] 我们这边直接 curl bore.pub:31425 ==========")
for i in range(1,4):
    r = subprocess.run(["curl","-sS","--max-time","10","-o","/tmp/local-bore.html","-w","HTTP=%{http_code}","http://bore.pub:31425/api/health"],
                       capture_output=True, text=True)
    print(f"  本地尝试 {i}/3: {r.stdout or ''} rc={r.returncode}")
    if r.returncode == 0 and "HTTP=200" in (r.stdout or ""):
        with open("/tmp/local-bore.html") as f:
            print("   body:", f.read()[:300])
        print("  ✅ bore.pub 公网转发 OK！")
        break
    time.sleep(3)
else:
    print("  ❌ 本地仍不通，打印 /tmp/local-bore.html：")
    try:
        with open("/tmp/local-bore.html") as f: print("   ", f.read()[:400])
    except: pass

print("\n========== 诊断完成 ==========")
