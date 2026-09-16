import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRelease, bookingDate, chooseCourt, reserve } from '../src/engine.mjs';

test('北京时间10点及跨月预约日期', () => {
  assert.equal(nextRelease(new Date('2026-09-10T01:59:59Z'), '10:00').toISOString(), '2026-09-10T02:00:00.000Z');
  assert.equal(nextRelease(new Date('2026-09-10T02:00:01Z'), '10:00').toISOString(), '2026-09-11T02:00:00.000Z');
  assert.equal(bookingDate(new Date('2026-09-30T02:00:00Z')), '2026-10-01');
});
test('可配置22点放号，保留次日预约日期并拒绝无效时间', () => {
  const release = nextRelease(new Date('2026-09-10T13:59:59Z'));
  assert.equal(release.toISOString(), '2026-09-10T14:00:00.000Z');
  assert.equal(bookingDate(release), '2026-09-11');
  assert.equal(nextRelease(new Date('2026-09-10T14:00:01Z'), '22:00').toISOString(), '2026-09-11T14:00:00.000Z');
  assert.equal(nextRelease(new Date('2026-09-10T15:59:59Z'), '00:00').toISOString(), '2026-09-10T16:00:00.000Z');
  assert.throws(() => nextRelease(new Date(), '24:00'), /HH:mm/);
});
const slots = [
  { id: 'a', courtId: '1', start: '19:00', end: '20:00', available: true },
  { id: 'b', courtId: '1', start: '20:00', end: '21:00', available: true }
];
test('不同场地的两个小时不能拼单', () => {
  assert.equal(chooseCourt([slots[0], { ...slots[1], courtId: '2' }]), null);
  assert.deepEqual(chooseCourt(slots).slotIds, ['a', 'b']);
});
test('兼容整块两小时及半小时组合，缺口或售出不能拼接', () => {
  assert.deepEqual(chooseCourt([{ id: 'whole', courtId: '1', start: '19:00', end: '21:00', available: true }]).slotIds, ['whole']);
  const half = ['19:00', '19:30', '20:00', '20:30'].map((start, i) => ({ id: String(i), courtId: '1', start, end: ['19:30', '20:00', '20:30', '21:00'][i], available: true }));
  assert.equal(chooseCourt(half).slotIds.length, 4);
  assert.equal(chooseCourt(half.filter(s => s.id !== '2')), null);
  half[1].available = false; assert.equal(chooseCourt(half), null);
});
function fixture() {
  const state = { record: null, calls: 0, payments: 0 };
  const hold = { status: 'HELD', orderId: 'order1', courtId: '1', date: '2026-09-11',
    start: '19:00', end: '21:00', expiresAt: '2026-09-10T02:05:00Z' };
  const adapter = {
    openLogin: async () => {}, waitForLogin: async () => ({ identity: '师生' }),
    prepare: async () => {}, listSlots: async () => slots,
    hold: async () => { state.calls++; return hold; },
    getOrder: async () => hold, openPayment: async () => { state.payments++; }
  };
  return { state, adapter, journal: { read: async () => state.record, put: async v => { state.record = v; } },
    release: new Date('2026-09-10T02:00:00Z'), now: () => new Date('2026-09-10T02:00:01Z'),
    waitUntil: async () => {}, askPayment: async () => false, log: () => {} };
}
test('锁定一次后停止，不确认不打开付款页', async () => {
  const f = fixture(); await reserve(f);
  assert.equal(f.state.calls, 1); assert.equal(f.state.payments, 0);
  await assert.rejects(reserve(f), /已有运行记录/);
});
test('提前准备在放号前完成，实时查询和唯一提交必须等到放号', async () => {
  const f=fixture(), due=f.release.getTime(), phases=[];
  let clock=due-10000, preparedAt, queriedAt;
  f.now=()=>new Date(clock);
  f.adapter.waitForLogin=async()=>{clock+=1000;return {identity:'师生'};};
  f.adapter.prepare=async()=>{clock+=2000;preparedAt=clock;};
  f.waitUntil=async d=>{clock=Math.max(clock,d.getTime());};
  f.adapter.listSlots=async()=>{queriedAt=clock;clock+=100;return slots;};
  f.adapter.preflight=async()=>{clock+=100;};
  const hold=f.adapter.hold;
  f.adapter.hold=async()=>{assert.ok(clock>=due);clock+=100;return hold();};
  f.onPhase=p=>phases.push(p);
  await reserve(f);
  assert.equal(preparedAt,due-7000);
  assert.equal(queriedAt,due);
  assert.equal(clock-due,300);
  assert.equal(f.state.calls,1);
  assert.deepEqual(phases,['preparing','waiting','querying','validating','submitting','held']);
});
test('明确确认后仅导航一次', async () => {
  const f = fixture(); f.askPayment = async () => true;
  await reserve(f); assert.equal(f.state.payments, 1);
});
test('提交超时不会重试下单，重启也阻止重复', async () => {
  const f = fixture(); f.adapter.hold = async () => { f.state.calls++; throw Error('timeout'); };
  await assert.rejects(reserve(f), /不确定/);
  assert.equal(f.state.record.state, 'UNKNOWN');
  await assert.rejects(reserve(f), /已有运行记录/);
  assert.equal(f.state.calls, 1);
});
test('市民登录不能按师生身份预约', async () => {
  const f = fixture(); f.adapter.waitForLogin = async () => ({ identity: '市民' });
  await assert.rejects(reserve(f), /师生登录/); assert.equal(f.state.calls, 0);
});
test('过期订单不能跳转支付', async () => {
  const f = fixture(); f.askPayment = async () => true;
  f.adapter.getOrder = async () => ({ status: 'EXPIRED', orderId: 'order1' });
  await assert.rejects(reserve(f), /失效/); assert.equal(f.state.payments, 0);
});
test('只锁定一小时不算成功', async () => {
  const f = fixture(); const original = f.adapter.hold;
  f.adapter.hold = async () => ({ ...await original(), end: '20:00' });
  await assert.rejects(reserve(f), /无法确认/);
  assert.equal(f.state.record.state, 'UNKNOWN');
});
