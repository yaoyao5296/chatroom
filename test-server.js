import http from 'http';
const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  console.log(`[request] ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>ChatRoom 测试页面</h1><p>服务器运行正常！</p>');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[test-server] 就绪，端口: ${PORT}`);
});