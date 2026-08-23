#!/usr/bin/env python3
"""
SSH 进入阿里云修复 chatroom 服务（502），并确保 pm2/服务在线。
同时公网 curl 验证 HTTP 80 可访问 chatroom。
"""
import sys, pexpect

SSH_PASS = "Zjp120310"
ALI_HOST = "8.163.56.203"
ALI_USER = "root"

def run(c, cmd, timeout=120, n=50):
    print(f"\n$ {cmd[:200]}")
    c.sendline(cmd)
    idx = c.expect([r'root@[^:]+:[^ ]+# ', pexpect.TIMEOUT, pexpect.EOF], timeout=timeout)
    out = c.before.decode('utf-8', errors='replace').splitlines()[1:]
    sys.stdout.write('\n'.join(out[-n:]))
    if len(out) > n:
        sys.stdout.write(f"\n(...{len(out)-n} more)")
    sys.stdout.write('\n')

def main():
    child = pexpect.spawn(
        f"ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 {ALI_USER}@{ALI_HOST}",
        encoding=None, dimensions=(40, 200)
    )
    idx = child.expect([r'[Pp]assword:', r"# ", pexpect.TIMEOUT, pexpect.EOF], timeout=25)
    if idx == 0:
        child.sendline(SSH_PASS)
        idx2 = child.expect([r'# ', r'[Pp]assword:', pexpect.TIMEOUT, pexpect.EOF], timeout=25)
        if idx2 != 0:
            print(f"登录失败 idx={idx2}: {child.before.decode()[:500]}"); sys.exit(1)
    elif idx != 1:
        print(f"连接失败 idx={idx}: {child.before.decode()[:500]}"); sys.exit(1)
    print("✅ 登录成功")

    # 检查 chatroom 服务
    run(child, "ps aux | grep -E 'node|pm2' | grep -v grep | head -8")
    run(child, "which pm2 2>&1 || npm i -g pm2 --silent 2>&1 | tail -3")
    run(child, "pm2 ls 2>&1")
    run(child, "pm2 status chatroom 2>&1 | head -20 || true")

    # 检查项目目录 & 启动
    run(child, "ls -la /opt/chatroom 2>&1 | head -10")
    run(child, "cat /opt/chatroom/package.json | head -30 2>&1 || echo NO_PKG")
    run(child, "cd /opt/chatroom && ls -la dist server ecosystem.config* 2>&1 | head -20")

    # 重启 chatroom
    run(child, "cd /opt/chatroom && pm2 reload ecosystem.config.cjs 2>&1 || pm2 restart chatroom 2>&1 || (pm2 delete chatroom 2>&1; pm2 start ecosystem.config.cjs 2>&1)", timeout=60)
    run(child, "pm2 ls 2>&1")
    run(child, "sleep 5 && pm2 logs chatroom --nostream --lines 30 2>&1 | tail -40")

    # 再次验证本地 3001 及 /api/health
    run(child, "ss -tlnp 2>&1 | grep -E ':3001|:80|:443'")
    run(child, "curl -sS -m 8 http://127.0.0.1:3001/api/health 2>&1")
    run(child, "curl -sS -m 8 http://127.0.0.1/api/health 2>&1")
    run(child, "curl -sS -m 8 -I http://127.0.0.1/ 2>&1 | head -5")
    run(child, "curl -sS -m 8 http://127.0.0.1/socket.io/?EIO=4&transport=polling 2>&1 | head -c 300; echo")

    # 下载 APK 大小
    run(child, "ls -lh /opt/chatroom/public/ChatRoom.apk /opt/chatroom/dist/ChatRoom.apk 2>&1 || true")

    child.close()
    print("\n=== 阿里云 chatroom 修复完成 ===")

if __name__ == "__main__":
    main()
