import fs from 'fs';
import path from 'path';
const LT_DIR = '/data/data/com.termux/files/usr/lib/node_modules/localtunnel';
const OPENURL = path.join(LT_DIR, 'node_modules/openurl/openurl.js');
if (fs.existsSync(OPENURL)) {
  const c = fs.readFileSync(OPENURL, 'utf8');
  if (c.includes('Unsupported platform')) fs.writeFileSync(OPENURL, "module.exports = { open: function(){}, mailto: function(){} };\n");
}
const ltMod = await import(LT_DIR + '/localtunnel.js');
const localtunnel = ltMod.default || ltMod;
const PORT = Number(process.argv[2]) || 3001;
const SUBDOMAIN = process.argv[3];
const NAME = process.argv[4] || SUBDOMAIN;
const t = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });
const got = t.url;
const ok = got.includes(SUBDOMAIN);
console.log(`[${NAME}] 子域名=${SUBDOMAIN}  →  实际=${got}  ${ok ? '✅ 匹配成功，固定可用' : '❌ 被占用'}`);
try { t.close(); } catch {}
process.exit(ok ? 0 : 1);
