import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadJson } from './profile.mjs';

function shape(value, prefix = '', depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return [prefix || '$'];
  if (Array.isArray(value)) return value.length ? shape(value[0], `${prefix}[]`, depth + 1) : [`${prefix}[]`];
  return Object.keys(value).slice(0, 80).flatMap(k => shape(value[k], prefix ? `${prefix}.${k}` : k, depth + 1));
}
function jsonShape(text) {
  try { return shape(JSON.parse(text)).slice(0, 150); } catch { return []; }
}
export function inspectHar(har) {
  if (!Array.isArray(har.log?.entries)) throw Error('不是有效的HAR文件');
  return har.log.entries.map((entry, index) => {
    const r = entry.request; const url = new URL(r.url);
    let body = entry.response?.content?.text || '';
    if (entry.response?.content?.encoding === 'base64') body = Buffer.from(body, 'base64').toString('utf8');
    return { index, method: r.method, origin: url.origin,
      // Never print query values, headers, bodies or response values.
      path: url.pathname.split('/').map(s => s.length > 32 ? '[long-segment]' : s).join('/'),
      queryKeys: [...url.searchParams.keys()], headerNames: (r.headers || []).map(h => h.name),
      bodyKeys: r.postData?.params?.map(p => p.name) || jsonShape(r.postData?.text || ''),
      status: entry.response?.status, responseFields: jsonShape(body) };
  });
}
export function extractSession(har, index, names) {
  const r = har.log?.entries?.[index]?.request;
  if (!r) throw Error('HAR请求序号不存在');
  const url = new URL(r.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('只导入HTTPS请求的会话');
  if (!names.length) throw Error('必须明确指定会话头名称，例如Cookie或Authorization');
  const headers = {};
  const denied = /^(host|content-length|connection|transfer-encoding|proxy-authorization|accept-encoding|content-type)$/i;
  for (const name of names) {
    if (denied.test(name) || !/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('不能导入该请求头');
    const matches = (r.headers || []).filter(h => h.name.toLowerCase() === name.toLowerCase());
    if (matches.length !== 1 || !matches[0].value || /[\r\n]/.test(matches[0].value)) throw Error('指定会话头缺失、重复或无效');
    headers[name.toLowerCase()] = matches[0].value;
  }
  return { version: 1, origins: { [url.origin]: { headers } } };
}
export async function harCommand(args) {
  const [action, input, index, headerList] = args;
  if (!input) throw Error('用法：har inspect 文件.har，或 har session 文件.har 请求序号 Cookie,Authorization');
  const har = await loadJson(input);
  if (action === 'inspect') {
    const output = '.local/har-index.json';
    await mkdir('.local', { recursive: true });
    await writeFile(output, JSON.stringify(inspectHar(har), null, 2), { mode: 0o600 });
    console.log('已生成 .local/har-index.json（仅结构，无请求/响应值）。');
  } else if (action === 'session') {
    if (!/^\d+$/.test(index || '')) throw Error('请求序号必须为非负整数');
    const session = extractSession(har, Number(index), (headerList || '').split(',').filter(Boolean));
    const output = '.local/session.json';
    await mkdir(dirname(output), { recursive: true });
    // Preserve an existing credential file; refresh deliberately after moving the previous file.
    await writeFile(output, JSON.stringify(session, null, 2), { flag: 'wx', mode: 0o600 });
    console.log('已导入 .local/session.json；会话值不会打印，也不会上传。');
  } else throw Error('未知HAR命令');
}
