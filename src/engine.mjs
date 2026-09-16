import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {compactSegments,samePlan,filterCourts} from './court-plan.mjs';

const OFFSET = 8 * 60 * 60 * 1000;
export function nextRelease(now = new Date(), releaseAt = '22:00') {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(releaseAt)) throw Error('放号时间必须为北京时间HH:mm');
  const [hour, minute] = releaseAt.split(':').map(Number);
  const local = new Date(now.getTime() + OFFSET);
  let release = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour - 8, minute);
  if (release < now.getTime()) release += 86400000;
  return new Date(release);
}
export function bookingDate(release) {
  return new Date(release.getTime() + OFFSET + 86400000).toISOString().slice(0, 10);
}
export function chooseCourt(slots, targetStart = '19:00', targetEnd = '21:00', allowSwitch=false) {
  const minutes = value => {
    if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
    const [h, m] = value.split(':').map(Number);
    return h < 24 && m < 60 ? h * 60 + m : NaN;
  };
  const startMinute = minutes(targetStart), endMinute = minutes(targetEnd);
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) throw Error('预约时间无效');
  const usable = slots.filter(s => s.id != null && s.courtId != null && s.available === true &&
    minutes(s.start) >= startMinute && minutes(s.end) <= endMinute && minutes(s.end) > minutes(s.start));
  const courts = [...new Set(usable.map(s => s.courtId))].sort();
  for (const courtId of courts) {
    const paths = new Map([[startMinute, []]]);
    for (const slot of usable.filter(s => s.courtId === courtId).sort((a, b) => minutes(a.start) - minutes(b.start))) {
      const path = paths.get(minutes(slot.start));
      if (path && !path.includes(slot.id)) paths.set(minutes(slot.end), [...path, slot.id]);
    }
    if (paths.has(endMinute)) return { courtId, slotIds: paths.get(endMinute) };
  }
  if(allowSwitch){
    const paths=new Map([[startMinute,[]]]);
    for(const slot of usable.sort((a,b)=>minutes(a.start)-minutes(b.start)||String(a.courtId).localeCompare(String(b.courtId)))){
      const path=paths.get(minutes(slot.start));if(!path)continue;
      const candidate=[...path,slot],old=paths.get(minutes(slot.end));
      if(!old||compactSegments(candidate).length<compactSegments(old).length)paths.set(minutes(slot.end),candidate);
    }
    const path=paths.get(endMinute);
    if(path)return {courtId:null,slotIds:path.map(s=>s.id),segments:compactSegments(path)};
  }
  return null;
}
export class Journal {
  constructor(path) { this.path = path; }
  async read() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async put(value) {
    await mkdir(dirname(this.path), { recursive: true });
    // Flush before submission; replace atomically to preserve prior state on interruption.
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, this.path);
  }
}

/** Adapter must use verified official UI/API; never infer a hold from a selected cell. */
export async function reserve({ adapter, journal, release, waitUntil, askPayment,
  now = () => new Date(), log = console.log, maxAttempts = 10,
  retryMs = 1000, paymentWaitMs = 180000, windowMs = 30000, identity = '师生', selection,
  onPhase = () => {} }) {
  const date = selection?.date ?? bookingDate(release);
  const request = { venue: adapter.profile?.venueName ?? '深圳大学城体育中心', sport: '网球', identity, date,
    start: selection?.start ?? '19:00', end: selection?.end ?? '21:00' };
  const previous = await journal.read();
  if (previous) throw new Error('本日期已有运行记录。请点击“核对所选日期的旧订单，解除重试限制”；官方确认取消或过期后才可重试。');
  onPhase('preparing');
  await adapter.openLogin();
  // The adapter waits for user login; passwords must never enter this program.
  const session = await adapter.waitForLogin();
  if (session.identity !== identity) throw new Error(`未确认${identity}登录身份，停止预约。`);
  await adapter.prepare(request);
  onPhase('waiting');
  await waitUntil(release);
  if (now().getTime() > release.getTime() + windowMs) throw new Error('已超过本轮预约窗口。');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (now().getTime() > release.getTime() + windowMs) break;
    onPhase('querying');
    const slots = await adapter.listSlots(request);
    const eligible=adapter.profile?filterCourts(slots,adapter.profile,selection?.includePremium===true):slots;
    const choice = chooseCourt(eligible, request.start, request.end,selection?.allowSwitch===true);
    if (!choice) {
      await waitUntil(new Date(now().getTime() + retryMs));
      continue;
    }
    const selected = { ...request, ...choice };
    // Read-only price validation happens before recording a possible submission.
    onPhase('validating');
    if (adapter.preflight) await adapter.preflight(selected);
    if (now().getTime() > release.getTime() + windowMs) break;
    // Persist before the only mutating call. An ambiguous response requires manual reconciliation.
    await journal.put({ state: 'SUBMITTING', selected });
    let hold;
    onPhase('submitting');
    try { hold = await adapter.hold(selected); }
    catch (error) {
      await journal.put({ state: 'UNKNOWN', selected });
      throw new Error('提交结果不确定，请先检查官方订单；不会自动再次下单。', { cause: error });
    }
    if (!hold || hold.status !== 'HELD' || !hold.orderId || hold.date !== date ||
      !samePlan(hold,selected) || hold.start !== request.start || hold.end !== request.end ||
      !Number.isFinite(Date.parse(hold.expiresAt)) || Date.parse(hold.expiresAt) <= now().getTime()) {
      await journal.put({ state: 'UNKNOWN', selected });
      throw new Error('无法确认完整两小时锁场及订单有效期，请检查官方订单。');
    }
    await journal.put({ state: 'HELD', selected, hold });
    onPhase('held');
    log(`已锁定 ${date} ${hold.courtId} ${request.start}–${request.end}；订单 ${hold.orderId}，有效期至 ${hold.expiresAt}。`);
    const timeout = Math.min(paymentWaitMs, Date.parse(hold.expiresAt) - now().getTime());
    const confirmed = timeout > 0 && await askPayment(timeout);
    if (confirmed && now().getTime() < Date.parse(hold.expiresAt)) {
      const current = await adapter.getOrder(hold.orderId);
      if (current.status !== 'HELD' || current.orderId !== hold.orderId ||
        current.date !== hold.date || !samePlan(current,hold) ||
        current.start !== hold.start || current.end !== hold.end ||
        !Number.isFinite(Date.parse(current.expiresAt)) || Date.parse(current.expiresAt) <= now().getTime() ||
        Date.parse(hold.expiresAt) <= now().getTime()) {
        throw new Error('订单已失效或状态已变化，不能打开付款页。');
      }
      const navigation = await adapter.openPayment(hold.orderId); // Navigation only; never pay.
      log(navigation?.opened === false
        ? '请在电脑微信的官方订单页选择“立即支付”，再选择“发送到手机微信支付”，由你在手机确认付款。'
        : '已请求打开官方付款页；如显示“发送到手机微信支付”，可选择后在手机确认付款。');
    } else log('未收到有效付款指示，保留订单记录；锁场期限以官方为准。');
    return hold;
  }
  log('本轮未发现同一场地连续两小时空位。');
  return null;
}
