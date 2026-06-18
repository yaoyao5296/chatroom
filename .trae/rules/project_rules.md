# ChatRoom 项目运行规则

## 工作区初始化

每次进入项目后，**必须按顺序执行以下命令**（不能跳过）：

### 1. 安装依赖
```bash
cd /workspace && npm install
```

### 2. 启动后端（端口 3001）
```bash
cd /workspace && node --import tsx api/server.ts &
```

### 3. 启动前端（端口 5173）
```bash
cd /workspace && node_modules/.bin/vite --port 5173 &
```

### 4. 打开预览
访问 http://localhost:5173

## 常见问题

### Q: 访问 localhost:5173 显示白屏或无法访问
原因：`node_modules` 被清空（沙箱机制会清理未 git 追踪的文件）
解决：重新运行 `bash setup.sh` 或依次执行上面的 1-3 步

### Q: 端口被占用（EADDRINUSE）
解决：先杀掉旧进程
```bash
lsof -ti:5173 | xargs kill -9; lsof -ti:3001 | xargs kill -9
```

### Q: 后端报错 Cannot find module 'tsx'
解决：重新 `npm install`

## 快速启动（一键）
```bash
bash /workspace/setup.sh
```
