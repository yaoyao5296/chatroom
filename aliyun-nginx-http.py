#!/usr/bin/env python3
"""
通过 Codespace 跳板 → pexpect SSH 进入阿里云 root@8.163.56.203
改 Nginx：去掉 SSL，只保留 80 HTTP 反代 chatroom
"""
import sys, os, time, json

import pexpect

SSH_PASS = "Zjp120310"
ALI_HOST = "8.163.56.203"
ALI_USER = "root"

def run(c, cmd, timeout=120):
    print(f"\n$ {cmd[:200]}")
    c.sendline(cmd)
    idx = c.expect([r'root@[^:]+:[^ ]+# ', pexpect.TIMEOUT, pexpect.EOF], timeout=timeout)
    out = c.before.decode('utf-8', errors='replace').splitlines()[1:]
    sys.stdout.write('\n'.join(out[-40:]))
    if len(out) > 40:
        sys.stdout.write(f"\n(...{len(out)-40} more)")
    sys.stdout.write('\n')

def main():
    print(f"=== SSH into 阿里云 {ALI_USER}@{ALI_HOST} ===")
    child = pexpect.spawn(
        f"ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 {ALI_USER}@{ALI_HOST}",
        encoding=None, dimensions=(40, 200)
    )
    idx = child.expect([r'[Pp]assword:', r"# ", pexpect.TIMEOUT, pexpect.EOF], timeout=25)
    if idx == 0:
        child.sendline(SSH_PASS)
        idx2 = child.expect([r'# ', r'[Pp]assword:', pexpect.TIMEOUT, pexpect.EOF], timeout=25)
        if idx2 != 0:
            print(f"登录失败 idx={idx2}: {child.before.decode()[:500]}")
            sys.exit(1)
    elif idx != 1:
        print(f"连接失败 idx={idx}: {child.before.decode()[:500]}")
        sys.exit(1)
    print("登录成功 ✅")

    run(child, "ls -la /etc/nginx/sites-enabled/ 2>&1")
    run(child, "ls -la /etc/nginx/sites-available/chatroom 2>&1 && echo ---EXISTS---")
    run(child, "cat /etc/nginx/sites-available/chatroom 2>&1 | head -50 || echo NO_CONFIG")

    # 写入新 Nginx 配置（纯 HTTP）
    new_cfg = r'''server {
    listen 80 default_server;
    server_name _;

    root /opt/chatroom/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3001;
    }
}
'''
    # 用 python -c base64 写入避免 heredoc 与 pexpect 的各种转义问题
    import base64
    b64 = base64.b64encode(new_cfg.encode()).decode()
    run(child, f"python3 -c \"import base64; open('/etc/nginx/sites-available/chatroom','w').write(base64.b64decode('{b64}').decode())\" 2>&1")
    run(child, "cat /etc/nginx/sites-available/chatroom | head -15")

    # 禁用默认站点，启用 chatroom 站点
    run(child, "rm -f /etc/nginx/sites-enabled/default 2>&1; ln -sf /etc/nginx/sites-available/chatroom /etc/nginx/sites-enabled/chatroom 2>&1")
    run(child, "ls -la /etc/nginx/sites-enabled/ 2>&1")

    # 也改 nginx.conf 里的默认 listen（可能在 /etc/nginx/nginx.conf 有个默认 server，冲突）
    run(child, "grep -nE 'listen 443|listen 80|default_server|include sites-enabled' /etc/nginx/nginx.conf 2>&1 | head -20")

    run(child, "nginx -t 2>&1")
    run(child, "(nginx -s reload 2>&1 || systemctl restart nginx 2>&1 || service nginx restart 2>&1); echo EXIT=$?")
    run(child, "systemctl status nginx --no-pager 2>&1 | head -12")

    run(child, "curl -sS -m 8 -I http://127.0.0.1/ 2>&1 | head -5")
    run(child, "curl -sS -m 8 http://127.0.0.1/api/health 2>&1")
    run(child, "curl -sS -m 8 -I http://127.0.0.1/ChatRoom.apk 2>&1 | grep -iE 'content-length|content-type|HTTP/'")

    run(child, "ss -tlnp 2>&1 | grep -E ':80|:443|:3001'")

    child.close()
    print("\n=== 完成 ===")

if __name__ == "__main__":
    main()
