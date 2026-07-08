"""
屿岸 Browser Use AI 代理微服务
- 接收任务请求，调用 Browser Use 执行浏览器自动化
- 通过 HTTP 回调通知 Node.js 后端任务结果
- 端口: 3002
"""
import os
import sys
import json
import time
import uuid
import threading
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO, format='[browser-agent] %(message)s')
logger = logging.getLogger('browser-agent')

PORT = int(os.getenv('BROWSER_AGENT_PORT', '3002'))
CALLBACK_URL = os.getenv('BROWSER_CALLBACK_URL', 'http://localhost:3001/api/ai/callback')

# 任务存储
tasks: dict[str, dict] = {}
tasks_lock = threading.Lock()

# LLM 配置
LLM_PROVIDER = os.getenv('BROWSER_LLM_PROVIDER', 'openai')
LLM_API_KEY = os.getenv('BROWSER_LLM_API_KEY', os.getenv('OPENAI_API_KEY', ''))
LLM_MODEL = os.getenv('BROWSER_LLM_MODEL', 'gpt-4o')
LLM_BASE_URL = os.getenv('BROWSER_LLM_BASE_URL', '')

# Ollama 本地模式不需要真实 API Key
IS_OLLAMA = LLM_PROVIDER == 'ollama' or 'ollama' in (LLM_BASE_URL or '')


def run_browser_task(task_id: str, task_desc: str, max_steps: int = 10):
    """在后台线程中执行 Browser Use 任务"""
    try:
        from browser_use import Agent, Browser, BrowserConfig
        from langchain_openai import ChatOpenAI

        with tasks_lock:
            tasks[task_id]['status'] = 'running'
            tasks[task_id]['started_at'] = time.time()

        # 配置 LLM
        llm_kwargs = {
            'model': LLM_MODEL,
            'api_key': LLM_API_KEY,
            'temperature': 0.1,
        }
        if LLM_BASE_URL:
            llm_kwargs['base_url'] = LLM_BASE_URL

        llm = ChatOpenAI(**llm_kwargs)

        # 配置浏览器
        browser = Browser(
            config=BrowserConfig(
                headless=True,
                disable_security=True,
            )
        )

        agent = Agent(
            task=task_desc,
            llm=llm,
            browser=browser,
            use_vision=True,
            max_failures=2,
            max_actions_per_step=2,
        )

        result = agent.run(max_steps=max_steps)

        # 提取结果
        output = ''
        if hasattr(result, 'final_result'):
            output = result.final_result()
        elif hasattr(result, 'history'):
            last = result.history[-1] if result.history else None
            if last and hasattr(last, 'result'):
                for r in last.result:
                    if hasattr(r, 'extracted_content'):
                        output = r.extracted_content
                        break

        with tasks_lock:
            tasks[task_id]['status'] = 'completed'
            tasks[task_id]['result'] = output or str(result)
            tasks[task_id]['finished_at'] = time.time()

        # 回调通知 Node.js
        _notify_callback(task_id, 'completed', tasks[task_id]['result'])

    except Exception as e:
        logger.error(f'任务 {task_id} 失败: {e}')
        with tasks_lock:
            tasks[task_id]['status'] = 'failed'
            tasks[task_id]['error'] = str(e)
        _notify_callback(task_id, 'failed', str(e))


def _notify_callback(task_id: str, status: str, result: str):
    """通知 Node.js 后端任务结果"""
    import urllib.request
    try:
        data = json.dumps({
            'task_id': task_id,
            'status': status,
            'result': result[:4000],  # 限制长度
        }).encode('utf-8')
        req = urllib.request.Request(
            CALLBACK_URL,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        logger.error(f'回调失败: {e}')


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info(format % args)

    def _send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/health':
            self._send_json({'status': 'ok', 'tasks_count': len(tasks)})

        elif parsed.path.startswith('/status/'):
            task_id = parsed.path.split('/')[-1]
            with tasks_lock:
                task = tasks.get(task_id)
            if task:
                self._send_json({
                    'task_id': task_id,
                    'status': task['status'],
                    'result': task.get('result', ''),
                    'error': task.get('error', ''),
                })
            else:
                self._send_json({'error': '任务不存在'}, 404)

        elif parsed.path == '/tasks':
            with tasks_lock:
                task_list = {
                    tid: {'status': t['status'], 'task': t['task'][:100]}
                    for tid, t in tasks.items()
                }
            self._send_json({'tasks': task_list})

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/run':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({'error': '无效的 JSON'}, 400)
                return

            task_desc = data.get('task', '')
            max_steps = data.get('max_steps', 10)
            user_id = data.get('user_id', '')
            source = data.get('source', 'chat')  # chat / group / auto
            target_id = data.get('target_id', '')  # 群ID或用户ID

            if not task_desc:
                self._send_json({'error': '请提供任务描述'}, 400)
                return

            if not LLM_API_KEY and not IS_OLLAMA:
                self._send_json({'error': '未配置 LLM API Key'}, 500)
                return

            task_id = str(uuid.uuid4())[:8]
            with tasks_lock:
                tasks[task_id] = {
                    'task': task_desc,
                    'status': 'pending',
                    'user_id': user_id,
                    'source': source,
                    'target_id': target_id,
                    'created_at': time.time(),
                }

            thread = threading.Thread(
                target=run_browser_task,
                args=(task_id, task_desc, max_steps),
                daemon=True,
            )
            thread.start()

            self._send_json({
                'task_id': task_id,
                'status': 'pending',
                'message': '任务已接收，正在执行...',
            })

        elif parsed.path == '/stop':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({'error': '无效的 JSON'}, 400)
                return

            task_id = data.get('task_id', '')
            with tasks_lock:
                task = tasks.get(task_id)
                if task and task['status'] in ('pending', 'running'):
                    task['status'] = 'stopped'
                    self._send_json({'task_id': task_id, 'status': 'stopped'})
                else:
                    self._send_json({'error': '任务不存在或已完成'}, 404)

        else:
            self._send_json({'error': 'Not found'}, 404)


def main():
    server = HTTPServer(('0.0.0.0', PORT), AgentHandler)
    logger.info(f'Browser Agent 服务已启动，端口: {PORT}')
    if IS_OLLAMA:
        logger.info(f'🤖 Ollama 本地模式: {LLM_MODEL} @ {LLM_BASE_URL or "http://localhost:11434/v1"}')
    elif not LLM_API_KEY:
        logger.warning('⚠ 未设置 BROWSER_LLM_API_KEY，服务将无法执行任务')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        logger.info('服务已停止')


if __name__ == '__main__':
    main()