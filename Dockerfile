# ChatRoom Railway 部署
FROM node:22-alpine

WORKDIR /app

# 安装构建依赖（better-sqlite3 需要编译工具 + Python AI 服务）
RUN apk add --no-cache python3 make g++ py3-pip && pip3 install --break-system-packages requests

COPY package.json ./
# 安装全部依赖（含 devDependencies，vite 构建需要）
RUN npm install && npm cache clean --force

COPY . .

# 构建前端
RUN npm run build

# 确保数据目录存在
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001

# 同时启动 AI 服务和主服务
CMD ["sh", "-c", "python3 api/browser_agent.py & sleep 2 && node --max-old-space-size=256 --optimize-for-size --import tsx api/server.ts"]