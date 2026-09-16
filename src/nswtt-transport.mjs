import { constants, createCipheriv, createDecipheriv, createHash, publicEncrypt, randomInt } from 'node:crypto';
import { mergeResponseCookies } from './session-store.mjs';

// Wire format verified against the locally installed app's core/utils/e.js.
export function encodeRequest(plain, publicKey, { timestamp = Date.now(), key } = {}) {
  const alphabet = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  key ??= Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
  const secret = Buffer.from(key, 'utf8');
  if (secret.length !== 16) throw Error('Invalid request key');
  const iv = Buffer.from('0000000000000000');
  const cipher = createCipheriv('aes-128-cbc', secret, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
  const sn = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, secret).toString('base64');
  const sign = createHash('md5').update(`${timestamp}@${key}@${Buffer.from(plain).toString('base64')}`).digest('hex');
  return { body, headers: { 'x-app-sn': sn, 'x-app-sign': sign, 'x-app-timestamp': String(timestamp) },
    decode(encoded) {
      const decipher = createDecipheriv('aes-128-cbc', secret, iv);
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encoded, 'base64')), decipher.final()]).toString('utf8'));
    }
  };
}

export class NswttTransport {
  constructor(config, { fetchFn = fetch, onSessionUpdate } = {}) {
    this.config = config; this.fetchFn = fetchFn; this.onSessionUpdate = onSessionUpdate;
  }
  async updateCookies(lines) {
    const updated = mergeResponseCookies(this.config, lines);
    if (updated === this.config) return;
    if (this.onSessionUpdate) await this.onSessionUpdate(this.config, updated);
    Object.assign(this.config, updated);
  }
  async request(path, params = {}, method = 'GET') {
    if (!/^wtt\/[a-z0-9/]+$/.test(path) || !['GET', 'POST'].includes(method)) throw Error('无效请求路径或方法');
    await this.updateCookies([]);
    const cleaned = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null));
    const plain = method === 'POST' ? JSON.stringify(cleaned) : Object.entries(cleaned)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
    const packet = encodeRequest(plain, this.config.publicKey);
    const url = new URL('https://nswtt.rim20.com/api/' + path);
    if (method === 'GET') for (const [k, v] of Object.entries(cleaned)) url.searchParams.set(k, String(v));
    const headers = { ...this.config.headers, ...packet.headers, 'content-type': 'application/json; charset=utf-8', accept: 'application/json' };
    let json;
    try {
      const response = await this.fetchFn(url, { method, headers, body: method === 'POST' ? packet.body : undefined,
        redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error(`HTTP_${response.status}`);
      await this.updateCookies(response.headers.getSetCookie?.() ?? []);
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.length; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw Error('TOO_LARGE'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (json.data_encode) json.data = packet.decode(json.data_encode);
    } catch (error) {
      if (/^HTTP_\d+$/.test(error.message)) throw Error(`请求失败 ${error.message}，停止执行。`);
      throw Error('网络请求或协议解码失败，停止执行；未输出会话或正文。');
    }
    if (json.code === 100000 && json.msg === '用户未登录') {
      const error = new Error('登录会话已失效（平台：用户未登录，100000）。请在官方微信重新登录并导出新的HAR，在网页重新导入后再检查。');
      error.code = 'SESSION_REQUIRED';
      throw error;
    }
    if (json.code !== 0) throw Error(`平台返回业务错误码 ${Number.isFinite(json.code) ? json.code : '未知'}，停止执行。`);
    return json.data;
  }
}
