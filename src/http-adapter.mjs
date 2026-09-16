import { allowedUrl, field, render, validateProfile } from './profile.mjs';

const MAX_RESPONSE = 2 * 1024 * 1024;
function same(a, b) { return a != null && b != null && String(a) === String(b); }
export class HttpAdapter {
  constructor(profile, session, { fetchFn = fetch, navigate = async () => ({ opened: false }), log = console.log } = {}) {
    this.p = validateProfile(profile); this.session = session; this.fetchFn = fetchFn;
    this.navigate = navigate; this.log = log;
    if (session.version !== 1 || !session.origins) throw Error('无效的本地会话文件');
  }
  async request(name, variables = {}) {
    const op = this.p.operations[name];
    const context = { ...this.p.target, ...variables };
    const url = allowedUrl(op.url, this.p.origins);
    const query = render(op.query || {}, context);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const credentials = this.session.origins[url.origin];
    if (!credentials?.headers || !Object.keys(credentials.headers).length) throw Error('缺少该来源的本地登录会话');
    const headers = new Headers({ Accept: 'application/json', ...op.headers, ...credentials.headers });
    for (const forbidden of ['host', 'content-length', 'connection', 'transfer-encoding']) {
      if (headers.has(forbidden)) throw Error('会话包含不允许覆盖的传输头');
    }
    const init = { method: op.method, headers, redirect: 'error', signal: AbortSignal.timeout(5000) };
    if (op.encoding !== 'none') {
      const body = render(op.body || {}, context);
      if (op.encoding === 'json') {
        headers.set('Content-Type', 'application/json'); init.body = JSON.stringify(body);
      } else {
        if (Object.values(body).some(v => v !== null && typeof v === 'object')) throw Error('表单数组需使用slotIdsCsv或按真实编码修改适配器');
        headers.set('Content-Type', 'application/x-www-form-urlencoded'); init.body = new URLSearchParams(body).toString();
      }
    }
    let json;
    try {
      const response = await this.fetchFn(url, init);
      if ([401, 403].includes(response.status)) throw Error('SESSION');
      if (response.status === 429) throw Error('RATE');
      if (!response.ok) throw Error('HTTP');
      const reader = response.body.getReader();
      let size = 0; const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE) { await reader.cancel(); throw Error('SIZE'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      const reason = error.message === 'SESSION' ? '登录已失效或权限不足' : error.message === 'RATE' ? '平台限流' : '请求失败、超时或响应格式异常';
      throw Error(`${name}：${reason}，已停止；不会输出会话或响应正文。`);
    }
    for (const check of op.assertions) {
      if (field(json, check.path) !== check.equals) throw Error(`${name}响应未满足成功条件，停止执行。`);
    }
    return json;
  }
  async openLogin() { this.log('使用本地会话文件验证官方登录；程序不读取微信数据或账号密码。'); }
  async waitForLogin() {
    const json = await this.request('session'); const m = this.p.maps.session;
    if (!same(field(json, m.accountId), this.p.target.accountId) || field(json, m.identity) !== m.studentValue) throw Error('当前会话不是配置的本人师生账号');
    return { identity: '师生' };
  }
  async prepare(request) { this.target = request; }
  async listSlots(request) {
    // Re-check identity at release time, including after a long scheduling wait.
    await this.waitForLogin();
    const json = await this.request('slots', request); const m = this.p.maps.slots;
    const rows = field(json, m.rows);
    if (!Array.isArray(rows) || rows.length > 20000) throw Error('场次列表格式异常');
    return rows.filter(row => field(row, m.date) === request.date &&
      same(field(row, m.venueId), this.p.target.venueId) && same(field(row, m.sportId), this.p.target.sportId)).map(row => ({
      id: field(row, m.id), courtId: String(field(row, m.courtId)), start: field(row, m.start), end: field(row, m.end),
      available: field(row, m.available) === m.availableValue
    }));
  }
  async hold(selection) {
    const json = await this.request('hold', { ...selection, slotIdsCsv: selection.slotIds.join(',') });
    const orderId = field(json, this.p.maps.hold.orderId);
    if (!['string', 'number'].includes(typeof orderId) || !String(orderId)) throw Error('未返回订单号');
    // A successful submit response alone is not evidence of a locked court.
    return this.getOrder(String(orderId));
  }
  async getOrder(orderId) {
    const json = await this.request('order', { orderId }); const m = this.p.maps.order;
    if (!same(field(json, m.orderId), orderId) || !same(field(json, m.accountId), this.p.target.accountId) ||
      !same(field(json, m.venueId), this.p.target.venueId) || !same(field(json, m.sportId), this.p.target.sportId) ||
      field(json, m.identity) !== m.studentValue) throw Error('订单归属、师生身份、场馆或项目不匹配');
    const expiry = field(json, m.expiresAt);
    let millis;
    if (m.expiresFormat === 'iso') {
      if (typeof expiry !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(expiry)) throw Error('订单时间缺少明确时区');
      millis = Date.parse(expiry);
    } else {
      if (typeof expiry !== 'number' || !Number.isFinite(expiry)) throw Error('订单时间戳无效');
      millis = expiry * (m.expiresFormat === 'unixSeconds' ? 1000 : 1);
    }
    if (!Number.isFinite(millis)) throw Error('订单有效期无效');
    return {
      orderId: String(orderId), status: field(json, m.status) === m.heldValue ? 'HELD' : 'OTHER',
      courtId: String(field(json, m.courtId)), date: field(json, m.date), start: field(json, m.start), end: field(json, m.end),
      expiresAt: new Date(millis).toISOString()
    };
  }
  async openPayment(orderId) {
    if (!this.p.paymentUrl) return { opened: false };
    const url = allowedUrl(this.p.paymentUrl, this.p.origins);
    if (!this.p.paymentOrderParam) throw Error('付款页面缺少已核实的订单参数名');
    url.searchParams.set(this.p.paymentOrderParam, orderId);
    return this.navigate(url.href);
  }
}
