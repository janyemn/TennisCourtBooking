import { readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function locked(path, action) {
  let lock;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { lock = await open(path + '.write-lock', 'wx', 0o600); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(r => setTimeout(r, 50)); }
  }
  if (!lock) throw Error('会话文件正在更新，请稍后重试');
  try { return await action(); }
  finally { await lock.close(); await unlink(path + '.write-lock'); }
}
async function atomicWrite(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(tmp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(tmp, path); }
  finally { await unlink(tmp).catch(e => { if(e.code !== 'ENOENT') throw e; }); }
}
export async function replaceSession(path, value) {
  return locked(path, () => atomicWrite(path, value));
}
export function persistSessionRotation(path) {
  return (before, after) => locked(path, async () => {
    const current = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
    // An in-flight response from the old session must never overwrite a newly imported HAR.
    if (JSON.stringify(current) !== JSON.stringify(before)) throw Error('会话已由其他请求更新，请重新检查登录');
    await atomicWrite(path, after);
  });
}

export function mergeResponseCookies(session, lines, now = Date.now()) {
  const jar = new Map(String(session.headers?.cookie ?? '').split(';').filter(Boolean).map(part => {
    const i = part.indexOf('='); return i < 0 ? null : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(Boolean));
  const expiries = { ...(session.cookieExpiries ?? {}) };
  let changed = false;
  for (const [name, expiry] of Object.entries(expiries)) if (expiry <= now) { jar.delete(name); delete expiries[name]; changed = true; }
  for (const line of lines) {
    const [pair, ...attributes] = line.split(';'); const i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~\w]+$/.test(name) || /[\r\n;]/.test(value)) continue;
    const attrs = Object.fromEntries(attributes.map(a => { const j=a.indexOf('='); return j<0?[a.trim().toLowerCase(),'']:[a.slice(0,j).trim().toLowerCase(),a.slice(j+1).trim()]; }));
    // Only root-scoped cookies are observed in this client and shared by every API request.
    if (attrs.path !== '/') continue;
    if (attrs.domain && !['nswtt.rim20.com', 'rim20.com'].includes(attrs.domain.toLowerCase().replace(/^\./,''))) continue;
    let expiry = null;
    if (/^-?\d+$/.test(attrs['max-age'] ?? '')) expiry = now + Number(attrs['max-age']) * 1000;
    else if (attrs.expires && Number.isFinite(Date.parse(attrs.expires))) expiry = Date.parse(attrs.expires);
    if (expiry !== null && expiry <= now) { jar.delete(name); delete expiries[name]; }
    else { jar.set(name, value); if (expiry !== null) expiries[name] = expiry; else delete expiries[name]; }
    changed = true;
  }
  if (!changed) return session;
  return { ...session, headers: { ...session.headers, cookie: [...jar].map(([k,v])=>`${k}=${v}`).join('; ') },
    cookieExpiries: expiries, cookieUpdatedAt: new Date(now).toISOString() };
}
