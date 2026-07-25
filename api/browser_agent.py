"""
ChatRoom AI 问答服务 - 支持联网搜索和上下文记忆
端口: 3002
"""
import os, json, time, logging, socket, socketserver, re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# 读取 .env 文件
env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

logging.basicConfig(level=logging.INFO, format='[ai-chat] %(message)s')
logger = logging.getLogger('ai-chat')

PORT = int(os.getenv('BROWSER_AGENT_PORT', '3002'))
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN', '')
AI_MODEL = os.getenv('AI_MODEL', 'gpt-4o-mini')
API_URL = 'https://models.inference.ai.azure.com/chat/completions'

SYSTEM_PROMPT = (
    '你是"屿岸"，一个友好、热心的AI助手。'
    '请用自然流畅的中文回复用户。'
    '回答风格：简洁直接，像朋友聊天一样自然，不要啰嗦。'
    '尽量保持回复在300字以内。'
    ''
    '【重要规则 - 必须遵守】'
    '当用户的问题涉及以下内容时，你绝对不能直接说"我无法获取"或"我不知道"，'
    '而是必须输出 [SEARCH:关键词] 标记来触发联网搜索：'
    '- 实时天气、天气预报'
    '- 新闻、时事'
    '- 股价、汇率等金融数据'
    '- 任何需要最新信息的问题'
    ''
    '格式要求：你的回复末尾必须包含 [SEARCH:搜索关键词]'
    '例如：用户问"今天湖南天气怎么样"，你必须回复类似：'
    '"让我帮你查一下湖南今天的天气情况 [SEARCH:湖南长沙天气 2025年7月]"'
    ''
    '注意：如果你不确定答案，不要直接说不知道，而是使用 [SEARCH:xxx] 来搜索。'
)

# 对话历史存储（按会话ID，最多保留最近20轮）
chat_sessions: dict[str, list[dict]] = {}
MAX_HISTORY = 20


def web_search(query: str, max_results: int = 5) -> str:
    """联网搜索，返回格式化的搜索结果"""
    import urllib.request
    import urllib.parse

    def _fetch(url: str, headers: dict = None) -> str:
        req = urllib.request.Request(url, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            raise RuntimeError(f'请求失败: {e}')

    def _try_ddg_lite(q: str) -> str:
        """DuckDuckGo Lite HTML 搜索"""
        encoded = urllib.parse.quote(q)
        url = f'https://lite.duckduckgo.com/lite/?q={encoded}'
        html = _fetch(url, {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'})
        from html.parser import HTMLParser
        class Parser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results = []
                self._cur = None
                self._tag = None
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'a' and 'result-link' in attrs.get('class', ''):
                    self._cur = {'title': '', 'snippet': '', 'href': attrs.get('href', '')}
                    self._tag = 'a'
                elif tag == 'td' and 'result-snippet' in attrs.get('class', ''):
                    self._tag = 'td'
            def handle_endtag(self, tag):
                if tag == 'a' and self._tag == 'a':
                    self._tag = None
                elif tag == 'td' and self._tag == 'td':
                    self._tag = None
            def handle_data(self, data):
                if self._tag == 'a' and self._cur:
                    self._cur['title'] += data.strip()
                elif self._tag == 'td' and self._cur:
                    self._cur['snippet'] += data.strip()
                    if self._cur['title'] and self._cur not in self.results:
                        self.results.append(dict(self._cur))
                        self._cur = None
        parser = Parser()
        parser.feed(html)
        if parser.results:
            return "\n\n".join(
                f"【{r['title']}】\n{r['snippet']}\n链接: {r['href']}"
                for r in parser.results[:max_results]
            )
        return ""

    # 依次尝试多种搜索方式
    result = ""
    try:
        result = _try_ddg_lite(query)
    except Exception as e:
        logger.warning(f'DDG搜索失败: {e}')

    if result:
        return result

    # 降级：使用 Bing 搜索
    logger.info(f'尝试 Bing 搜索: {query}')
    try:
        encoded = urllib.parse.quote(query)
        url = f'https://www.bing.com/search?q={encoded}&setlang=zh-cn'
        html = _fetch(url, {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        })
        # 简单提取搜索结果
        import re as _re
        import html as _html
        snippets = _re.findall(r'<li class="b_algo"[^>]*>.*?<h2[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?<p[^>]*>(.*?)</p>', html, _re.DOTALL)
        if snippets:
            logger.info(f'Bing 搜索匹配到 {len(snippets)} 条结果')
            lines = []
            for href, title, snippet in snippets[:max_results]:
                title = _html.unescape(_re.sub(r'<[^>]+>', '', title)).strip()
                snippet = _html.unescape(_re.sub(r'<[^>]+>', '', snippet)).strip()
                lines.append(f"【{title}】\n{snippet}\n链接: {href}")
            if lines:
                return "\n\n".join(lines)
        else:
            logger.warning(f'Bing 搜索未匹配到结果')
    except Exception as e:
        logger.warning(f'Bing搜索失败: {e}')

    return "未找到相关搜索结果，请稍后重试。"


def call_ai(messages: list[dict], max_tokens: int = 800) -> str:
    """调用 GitHub Models API"""
    import urllib.request
    data = json.dumps({
        'model': AI_MODEL,
        'messages': messages,
        'temperature': 0.7,
        'max_tokens': max_tokens,
    }).encode('utf-8')
    req = urllib.request.Request(API_URL, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {GITHUB_TOKEN}',
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            return result['choices'][0]['message']['content']
    except Exception as e:
        raise RuntimeError(f'AI API 调用失败: {e}')


class ChatHandler(BaseHTTPRequestHandler):
    def log_message(self, f, *a):
        pass

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == '/health':
            self._send_json({'status': 'ok', 'model': AI_MODEL})
        elif p.path == '/search':
            params = parse_qs(p.query)
            query = params.get('q', [''])[0]
            if not query:
                self._send_json({'error': 'q required'}, 400)
                return
            logger.info(f'搜索: {query}')
            result = web_search(query)
            self._send_json({'success': True, 'results': result})
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        p = urlparse(self.path)
        if p.path == '/chat':
            length = int(self.headers.get('Content-Length', 0))
            try:
                data = json.loads(self.rfile.read(length))
            except:
                self._send_json({'error': 'invalid JSON'}, 400)
                return

            message = data.get('message', '').strip()
            if not message:
                self._send_json({'error': 'message required'}, 400)
                return

            session_id = data.get('sessionId', 'default')
            history = data.get('history', [])

            # 如果前端没传history，从服务端session获取
            if not history and session_id in chat_sessions:
                history = chat_sessions[session_id]

            # 构建消息列表
            messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
            for h in history[-MAX_HISTORY:]:
                if h.get('role') in ('user', 'assistant', 'system'):
                    messages.append({'role': h['role'], 'content': h['content']})
            messages.append({'role': 'user', 'content': message})

            logger.info(f'收到消息: {message[:50]}... (历史{len(history)}轮)')

            try:
                reply = call_ai(messages)
                logger.info(f'回复: {reply[:80]}...')

                # 检测是否需要联网搜索
                search_match = re.search(r'\[SEARCH:(.+?)\]', reply)
                if search_match:
                    search_query = search_match.group(1).strip()
                    logger.info(f'触发联网搜索: {search_query}')
                    search_results = web_search(search_query)

                    # 将搜索结果追加到消息中，再次调用AI
                    messages.append({'role': 'assistant', 'content': reply})
                    messages.append({
                        'role': 'system',
                        'content': f'以下是关于"{search_query}"的联网搜索结果，请基于这些信息给出准确回答:\n\n{search_results}'
                    })
                    reply = call_ai(messages, max_tokens=1000)
                    logger.info(f'搜索后回复: {reply[:80]}...')

                # 清理最终回复中的 [SEARCH:xxx] 标记
                reply = re.sub(r'\s*\[SEARCH:.+?\]', '', reply).strip()

                # 保存会话历史
                if session_id not in chat_sessions:
                    chat_sessions[session_id] = []
                chat_sessions[session_id].append({'role': 'user', 'content': message})
                chat_sessions[session_id].append({'role': 'assistant', 'content': reply})
                # 限制历史长度
                if len(chat_sessions[session_id]) > MAX_HISTORY * 2:
                    chat_sessions[session_id] = chat_sessions[session_id][-MAX_HISTORY * 2:]

                self._send_json({'reply': reply})
            except Exception as e:
                logger.error(f'AI调用失败: {e}')
                self._send_json({'error': str(e)}, 500)
        elif p.path == '/search':
            length = int(self.headers.get('Content-Length', 0))
            try:
                data = json.loads(self.rfile.read(length))
            except:
                self._send_json({'error': 'invalid JSON'}, 400)
                return
            query = data.get('query', '').strip()
            if not query:
                self._send_json({'error': 'query required'}, 400)
                return
            logger.info(f'搜索: {query}')
            result = web_search(query)
            self._send_json({'success': True, 'results': result})
        else:
            self._send_json({'error': 'not found'}, 404)


def main():
    import signal
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    socketserver.TCPServer.allow_reuse_address = True
    HTTPServer.allow_reuse_address = True

    for i in range(8):
        try:
            server = HTTPServer(('0.0.0.0', PORT), ChatHandler)
            server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            break
        except OSError:
            if i < 7:
                time.sleep(3)
            else:
                raise

    logger.info(f'AI Chat 已启动 :{PORT} 模型={AI_MODEL} 支持联网搜索+上下文')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()