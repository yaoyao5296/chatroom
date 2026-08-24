module.exports = {
  apps: [{
    name: 'chatroom',
    script: 'api/server.ts',
    interpreter: 'node',
    interpreterArgs: '--import tsx --optimize-for-size --max-semi-space-size=1 --initial-old-space-size=64',
    instances: 1, exec_mode: 'fork', autorestart: true, watch: false, max_memory_restart: '500M',
    error_file: './logs/err.log', out_file: './logs/out.log',
    env: { NODE_ENV: 'production', PORT: 3001, HOST: '0.0.0.0' },
  }]
};
