import { loadJson } from './profile.mjs';
import { replaceSession } from './session-store.mjs';

// Refresh only the provided HAR's target-app session, never inspect other accounts/apps.
const path = process.argv[2];
if (!path) throw Error('用法：node src/refresh-session.mjs HAR路径');
const har = await loadJson(path);
const entries = har.log.entries.filter(e => {
  const u = new URL(e.request.url);
  return u.origin === 'https://nswtt.rim20.com' && u.pathname.startsWith('/api/wtt/');
});
const session = await loadJson('.local/session.json');
const allowed = ['cookie', 'app-version', 'x-page-uuid', 'referer', 'user-agent'];
const candidate = [...entries].reverse().find(e => e.request.headers.some(h => h.name.toLowerCase() === 'cookie' && h.value));
if (!candidate) throw Error('HAR中未找到目标小程序的会话请求');
session.headers = Object.fromEntries(candidate.request.headers.filter(h => allowed.includes(h.name.toLowerCase()))
  .map(h => [h.name.toLowerCase(), h.value]));
delete session.cookieExpiries;delete session.cookieUpdatedAt;session.importedAt=new Date().toISOString();
await replaceSession('.local/session.json',session);
console.log('已更新本地会话；运行 npm start -- check 验证本人身份。');
