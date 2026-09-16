import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HttpAdapter } from '../src/http-adapter.mjs';
import { render, validateProfile } from '../src/profile.mjs';
import { reserve } from '../src/engine.mjs';

const example = JSON.parse(await readFile(new URL('../config/profile.example.json', import.meta.url), 'utf8'));
function fixture() {
  const p = JSON.parse(JSON.stringify(example).replaceAll('https://replace-with-captured-host.invalid', 'https://booking.example.test'));
  p.verified = true; p.operations.hold.createsUnpaidOrderOnly = true;
  for (const op of Object.values(p.operations)) op.evidence = '本地测试替身，无外部请求';
  p.target = { accountId: 'self', venueId: 'university', sportId: 'tennis' };
  const requests = []; let submits = 0;
  const order = { orderId: 'o1', userId: 'self', role: 'student', venueId: 'university', sportId: 'tennis', courtId: 'c1',
    date: '2026-09-11', start: '19:00', end: '21:00', status: 'UNPAID', expiresAt: '2026-09-10T02:05:00Z' };
  const fetchFn = async (url, init) => {
    requests.push({ url: String(url), init });
    let data;
    switch (url.pathname) {
      case '/session': data = { userId: 'self', role: 'student' }; break;
      case '/slots': data = { slots: [
        { id: 's1', courtId: 'c1', date: '2026-09-11', venueId: 'university', sportId: 'tennis', start: '19:00', end: '20:00', available: true },
        { id: 's2', courtId: 'c1', date: '2026-09-11', venueId: 'university', sportId: 'tennis', start: '20:00', end: '21:00', available: true }
      ] }; break;
      case '/orders/create': submits++; data = { orderId: 'o1' }; break;
      case '/orders/detail': data = order; break;
      default: throw Error('Unexpected route');
    }
    return Response.json({ code: 0, data });
  };
  const session = { version: 1, origins: { 'https://booking.example.test': { headers: { Cookie: 'SELF_SESSION' } } } };
  return { p, order, session, requests, fetchFn, submits: () => submits };
}
test('示例不能用于真实请求', () => assert.throws(() => validateProfile(example), /尚未核实/));
test('模板保留数组类型且拒绝缺失变量', () => {
  assert.deepEqual(render({ ids: '{{slotIds}}' }, { slotIds: ['a', 'b'] }), { ids: ['a', 'b'] });
  assert.throws(() => render('{{missing}}', {}), /缺失/);
});
test('HTTP全流程：携带本人会话、一次提交、再次查单，不调用支付', async () => {
  const f = fixture(); let record = null;
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: f.fetchFn, log: () => {} });
  const hold = await reserve({ adapter, release: new Date('2026-09-10T02:00:00Z'),
    now: () => new Date('2026-09-10T02:00:01Z'), waitUntil: async () => {}, askPayment: async () => false,
    journal: { read: async () => record, put: async v => { record = v; } }, log: () => {} });
  assert.equal(hold.orderId, 'o1'); assert.equal(f.submits(), 1); assert.equal(record.state, 'HELD');
  const submit = f.requests.find(r => r.init.method === 'POST');
  assert.deepEqual(JSON.parse(submit.init.body).slotIds, ['s1', 's2']);
  assert.ok(f.requests.every(r => r.init.headers.get('cookie') === 'SELF_SESSION' && r.init.redirect === 'error'));
  assert.ok(!f.requests.some(r => /pay/.test(r.url)));
});
test('其他账号订单不能确认锁场', async () => {
  const f = fixture(); f.order.userId = 'someone-else';
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: f.fetchFn });
  await assert.rejects(adapter.getOrder('o1'), /归属/);
});
test('创建成功但查单断网时记录UNKNOWN，重启不重复提交', async () => {
  const f = fixture(); let record = null;
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: async (url, init) => {
    if (url.pathname === '/orders/detail') throw Error('network');
    return f.fetchFn(url, init);
  }, log: () => {} });
  const options = { adapter, release: new Date('2026-09-10T02:00:00Z'),
    now: () => new Date('2026-09-10T02:00:01Z'), waitUntil: async () => {}, askPayment: async () => false,
    journal: { read: async () => record, put: async v => { record = v; } }, log: () => {} };
  await assert.rejects(reserve(options), /不确定/);
  assert.equal(record.state, 'UNKNOWN');
  await assert.rejects(reserve(options), /已有运行记录/);
  assert.equal(f.submits(), 1);
});
test('时间缺少时区不能猜测有效期', async () => {
  const f = fixture(); f.order.expiresAt = '2026-09-10 10:05:00';
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: f.fetchFn });
  await assert.rejects(adapter.getOrder('o1'), /时区/);
});
test('限流停止且不暴露响应或凭据', async () => {
  const f = fixture(); let calls = 0;
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: async () => { calls++; return new Response('SECRET', { status: 429 }); } });
  await assert.rejects(adapter.waitForLogin(), e => /限流/.test(e.message) && !/SECRET|SELF_SESSION/.test(e.message));
  assert.equal(calls, 1);
});
test('来源不匹配时不发送凭据', async () => {
  const f = fixture(); f.p.origins.push('https://other.example.test'); f.p.operations.session.url = 'https://other.example.test/session';
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: f.fetchFn });
  await assert.rejects(adapter.waitForLogin(), /缺少该来源/); assert.equal(f.requests.length, 0);
});
test('未经确认不提供付款导航；订单参数按URL编码', async () => {
  const f = fixture(); let opened;
  const adapter = new HttpAdapter(f.p, f.session, { fetchFn: f.fetchFn, navigate: async url => { opened = url; return { opened: true }; } });
  assert.deepEqual(await adapter.openPayment('o1'), { opened: false });
  f.p.paymentUrl = 'https://booking.example.test/order'; f.p.paymentOrderParam = 'orderId';
  await adapter.openPayment('a&b');
  assert.equal(new URL(opened).searchParams.get('orderId'), 'a&b');
});
