import {samePlan} from './court-plan.mjs';
import {normalizeOrder} from './nswtt-adapter.mjs';
export const orderJobStatuses = ['held', 'payment_pending', 'payment_ready', 'payment_failed', 'payment_sent'];

// A job retains enough information to verify an order even after its journal was archived.
export async function reconcileJobRecords(adapter, previous, jobs) {
  const records = previous ? [previous] : [];
  for (const job of jobs.filter(j => orderJobStatuses.includes(j.status))) {
    if (!job.result?.orderId) throw Error('任务缺少订单编号，无法自动解除');
    if (!records.some(r => r.hold?.orderId === job.result.orderId)) {
      records.push({selected: job.result, hold: {orderId: job.result.orderId}});
    }
  }
  if (!records.length) return {clear: false, reason: '没有需要核对的提交记录'};
  const orders = [];
  for (const record of records) {
    const result = await reconcileReservation(adapter, record);
    orders.push(...result.orders);
  }
  return {clear: true, orders, checkedAt: new Date().toISOString()};
}

export function applyReconciliation(jobs, result) {
  if (!result.clear) return;
  for (const job of jobs) {
    const order = result.orders.find(o => o.orderId === job.result?.orderId);
    if (!order || ![200, 250].includes(order.status) || !orderJobStatuses.includes(job.status)) continue;
    job.status = order.status === 250 ? 'expired' : 'order_cancelled';
    job.message = order.status === 250 ? '官方已确认订单过期，可重新预约' : '官方已确认订单取消，可重新预约';
    job.orderCheckedAt = result.checkedAt;
  }
}

// Only a complete authenticated order scan can release an ambiguous local submission.
export async function reconcileReservation(adapter, previous) {
  if (!previous) return { clear: false, reason: '没有需要核对的提交记录' };
  await adapter.waitForLogin();
  const project = await adapter.client.request('wtt/sport/project/info', { id: adapter.profile.target.sportId });
  if (project.id !== adapter.profile.target.sportId || project.extid !== adapter.profile.target.venueId) throw Error('项目归属发生变化，保留运行记录');
  const selected = previous.selected;
  if (!selected?.date || (!selected?.courtId&&!selected?.segments?.length) || !selected?.start || !selected?.end) throw Error('旧记录不完整，无法自动解除');
  const court = project.placelist.find(p => p.id === selected.courtId);
  if (!court&&!selected.segments?.length) throw Error('旧记录对应的场地已不存在，无法自动解除');
  const ids = new Set(), summaries = new Map(); let complete = false;
  for (let page = 1; page <= 20; page++) {
    const data = await adapter.client.request('wtt/sport/order/list', { page, pagesize: 20 }, 'POST');
    if (!Array.isArray(data.list) || !Number.isInteger(data.count) || data.count < 0) throw Error('订单列表结构异常，保留运行记录');
    for (const order of data.list) { if (typeof order.id !== 'string' || !order.id) throw Error('订单编号无效'); ids.add(order.id); summaries.set(order.id,order.status); }
    if (ids.size >= data.count) { complete = true; break; }
    if (!data.list.length) break;
  }
  if (!complete) throw Error('未能完整读取订单，保留运行记录');
  const terminal = [];
  for (const id of ids) {
    // With an exact recorded ID, unrelated terminal orders cannot be the old hold
    // or an active duplicate. Unknown submissions still need a complete detail scan.
    if(previous.hold?.orderId && id !== previous.hold.orderId && [200,250].includes(summaries.get(id))) continue;
    const order = await adapter.client.request('wtt/sport/order/info', { id }, 'POST');
    if (order.id !== id) throw Error('订单编号不匹配');
    if (order.projectid !== project.id || !String(order.slicestarttime).startsWith(selected.date + ' ')) continue;
    if (![200, 250].includes(order.status)) throw Error('该日期仍有待付款、已付款或未确认状态的订单，不能重复预约');
    const venueOK = order.extid === project.extid || (order.extid === project.showextid && order.extname === project.extname);
    const selfOK = order.playerlist?.some(p => p.idcardhash === adapter.profile.selfHash);
    // Terminal status was verified above; use the same strict segment parser as a live order.
    const planOK=selected.segments?.length?samePlan(normalizeOrder({...order,status:50,countdown:1},adapter.profile,project,Date.now()),selected):order.placememo===court.name;
    if (venueOK && selfOK && order.slicestarttime === `${selected.date} ${selected.start}:00` &&
        order.sliceendtime === `${selected.date} ${selected.end}:00` && planOK &&
        (!previous.hold?.orderId || previous.hold.orderId === order.id)) {
      terminal.push({ orderId: order.id, status: order.status });
    }
  }
  if (!terminal.length) throw Error('没有找到与旧提交完全匹配的已取消或已过期订单，保留运行记录');
  return { clear: true, orders: terminal, checkedAt: new Date().toISOString() };
}
