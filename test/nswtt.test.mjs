import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { encodeRequest, NswttTransport } from '../src/nswtt-transport.mjs';
import { NswttAdapter, normalizeSlots, normalizeOrder } from '../src/nswtt-adapter.mjs';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
test('encrypted protocol preserves Unicode JSON, signature and encrypted response', () => {
  const key = 'abcdefgh23456789', plain = JSON.stringify({ sport: '网球', id: 'a,b' });
  const packet = encodeRequest(plain, publicKey, { key, timestamp: 12345 });
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0000000000000000'));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(packet.body, 'base64')), decipher.final()]).toString(), plain);
  assert.equal(packet.headers['x-app-sign'], createHash('md5').update(`12345@${key}@${Buffer.from(plain).toString('base64')}`).digest('hex'));
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0000000000000000'));
  assert.deepEqual(packet.decode(Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64')), JSON.parse(plain));
});
test('transport rejects foreign paths and redacts business response text', async () => {
  const t = new NswttTransport({ publicKey, headers: {} }, { fetchFn: async () => new Response(JSON.stringify({ code: 1, msg: 'private mobile' })) });
  await assert.rejects(t.request('../pay'), /无效/);
  await assert.rejects(t.request('wtt/sport/order/check'), e => !e.message.includes('private') && e.message.includes('1'));
});
test('observed platform login error gives actionable refresh instructions',async()=>{
 const t=new NswttTransport({publicKey,headers:{}},{fetchFn:async()=>new Response(JSON.stringify({code:100000,msg:'用户未登录'}))});
 await assert.rejects(t.request('wtt/user/wttauth/info',{},'POST'),e=>e.code==='SESSION_REQUIRED'&&e.message.includes('HAR'));
});
const profile = { target: { sportId: 'tennis', venueId: 'campus', accountId: 'self' }, selfHash: 'hash', playerIds: ['self-player'], payeeconfigid: 'wechat', extype: 41 };
const project = { placelist: [{ id: 'court2', name: '网球2号场' }] };
const raw = { issale: 200, slicelist: [
  { id: 'a,b', placeid: 'court2', starttime: '19:00', endtime: '20:00', status: 200, stocknum: 1, finallocknum: 0, finaltakenum: 0, paytypes: '2', finalunitpricey: 80 },
  { id: 'c,d', placeid: 'court2', starttime: '20:00', endtime: '21:00', status: 200, stocknum: 1, finallocknum: 0, finaltakenum: 0, paytypes: '2', finalunitpricey: 80 }
] };
const selected = { date: '2026-09-12', courtId: 'court2', start: '19:00', end: '21:00', slotIds: ['a,b', 'c,d'] };
const order = { id: 'order', projectid: 'tennis', extid: 'campus', paytype: 2, playerlist: [{ idcardhash: 'hash' }], status: 50, countdown: 240,
  slicestarttime: '2026-09-12 19:00:00', sliceendtime: '2026-09-12 21:00:00',
  slicememo: '网球2号场 (2026-09-12 19:00-19:30)\n网球2号场 (2026-09-12 19:30-20:00)\n网球2号场 (2026-09-12 20:00-20:30)\n网球2号场 (2026-09-12 20:30-21:00)' };
test('slot normalization retains paired slice IDs and rejects unavailable stock', () => {
  assert.equal(normalizeSlots(raw, selected.date)[0].id, 'a,b');
  assert.equal(normalizeSlots({ ...raw, issale: 100 }, selected.date)[0].available, false);
  assert.equal(normalizeSlots({ ...raw, slicelist: [{ ...raw.slicelist[0], finaltakenum: 1 }] }, selected.date)[0].available, false);
});
test('order confirmation verifies participant, exact contiguous court time and server countdown', () => {
  assert.equal(normalizeOrder(order, profile, project, 1000).expiresAt, new Date(241000).toISOString());
  assert.throws(() => normalizeOrder({ ...order, playerlist: [] }, profile, project, 1000));
  assert.throws(() => normalizeOrder({ ...order, slicememo: order.slicememo.replace('19:30-20:00', '19:45-20:00') }, profile, project, 1000));
  assert.throws(() => normalizeOrder({ ...order, countdown: 0 }, profile, project, 1000));
});
test('order venue may use the verified project display venue, but unrelated venues are rejected', () => {
  const linked={...project,id:'tennis',extid:'campus',showextid:'display-campus',extname:'深圳大学城体育中心'};
  const displayed={...order,extid:'display-campus',extname:'深圳大学城体育中心'};
  assert.equal(normalizeOrder(displayed,profile,linked,1000).status,'HELD');
  assert.throws(()=>normalizeOrder({...displayed,extid:'other'},profile,linked,1000));
  assert.throws(()=>normalizeOrder(displayed,profile,{...linked,id:'other-project'},1000));
});
function fixture({ pending = 0, price = 16000 } = {}) {
  const calls = [];
  const a = new NswttAdapter(profile, { appid: 'app' }, { transport: { async request(path, body) {
    calls.push({ path, body });
    if (path.endsWith('/list')) return { count: pending, list: pending ? [{}] : [] };
    if (path.endsWith('/check')) return { totalprice: price, payprice: price, payeelist: [{ payeeconfigid: 'wechat', payeetype: 0 }] };
    if (path.endsWith('/add')) return { id: 'order' };
    if (path.endsWith('/info')) return order;
    throw Error('Unexpected endpoint');
  } } });
  Object.assign(a, { project, slots: raw, date: selected.date });
  return { a, calls };
}
test('one unpaid order submission preserves both paired slots and never calls payment', async () => {
  const { a, calls } = fixture();
  await a.preflight(selected); const held = await a.hold(selected);
  assert.equal(held.status, 'HELD');
  const add = calls.find(c => c.path.endsWith('/add'));
  assert.deepEqual(add.body.slicelist, [{ buynum: 1, sliceid: 'a,b' }, { buynum: 1, sliceid: 'c,d' }]);
  assert.equal(add.body.playerids, 'self-player');
  assert.equal(add.body.paytype, 2);
  await assert.rejects(a.hold(selected));
  assert.deepEqual(await a.openPayment(), { opened: false });
  assert.equal(calls.filter(c => c.path.endsWith('/add')).length, 1);
  assert.equal(calls.some(c => c.path.includes('payapply')), false);
});
test('pending order or price mismatch blocks submission', async () => {
  for (const options of [{ pending: 1 }, { price: 18000 }]) {
    const { a, calls } = fixture(options);
    await assert.rejects(a.preflight(selected)); await assert.rejects(a.hold(selected));
    assert.equal(calls.some(c => c.path.endsWith('/add')), false);
  }
});
