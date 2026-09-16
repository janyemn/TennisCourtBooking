import { NswttTransport } from './nswtt-transport.mjs';
import {compactSegments,samePlan} from './court-plan.mjs';

export function normalizeSlots(data, date) {
  if (!Array.isArray(data.slicelist)) throw Error('场次列表结构变化');
  return data.slicelist.map(s => ({ id: s.id, courtId: s.placeid, date,
    start: s.starttime, end: s.endtime,
    available: data.issale === 200 && s.status === 200 && s.stocknum > 0 &&
      s.finallocknum === 0 && s.finaltakenum === 0 && String(s.paytypes).split(',').includes('2') }));
}

export function normalizeOrder(order, profile, project, startedAt) {
  const venueMatches = order.extid === profile.target.venueId ||
    (project.id === profile.target.sportId && project.extid === profile.target.venueId &&
     project.showextid && order.extid === project.showextid && order.extname === project.extname);
  if (order.projectid !== profile.target.sportId || !venueMatches ||
      order.paytype !== 2 || !order.playerlist?.some(p => p.idcardhash === profile.selfHash)) {
    throw Error('订单场馆、项目或本人参与信息不匹配');
  }
  const result = { orderId: order.id, status: order.status === 50 ? 'HELD' : 'OTHER' };
  if (result.status !== 'HELD') return result;
  const lines = String(order.slicememo).trim().split(/\r?\n/).map(line => {
    const m = line.trim().match(/^(.+?) \((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})-(\d{2}:\d{2})\)$/);
    if (!m) throw Error('订单场次描述无法核实');
    return { name: m[1], date: m[2], start: m[3], end: m[4] };
  }).sort((a, b) => a.start.localeCompare(b.start));
  const first = lines[0], last = lines.at(-1);
  const segments=compactSegments(lines.map(l=>{const courts=project.placelist.filter(p=>p.name===l.name);if(courts.length!==1)throw Error('订单场地无法核实');return {...l,courtId:courts[0].id};}));
  if (lines.some((l, i) => l.date !== first.date ||
      l.end <= l.start || (i && lines[i - 1].end !== l.start)) ||
      order.slicestarttime !== `${first.date} ${first.start}:00` ||
      order.sliceendtime !== `${first.date} ${last.end}:00` ||
      !Number.isFinite(order.countdown) || order.countdown <= 0) throw Error('订单场次或剩余锁定时间无法核实');
  return { ...result, date: first.date, courtId: segments.length===1?segments[0].courtId:null, segments, start: first.start, end: last.end,
    expiresAt: new Date(startedAt + order.countdown * 1000).toISOString() };
}

export class NswttAdapter {
  constructor(profile, session, { transport, onSessionUpdate } = {}) {
    this.profile = profile; this.session = session;
    this.client = transport ?? new NswttTransport(session, { onSessionUpdate });
  }
  async openLogin() {} // Login remains in official WeChat; import the user's fresh HAR session.
  async waitForLogin() {
    const user = await this.client.request('wtt/user/wttauth/info', {
      appid: this.session.appid, timestamp: Math.floor(Date.now() / 1000)
    }, 'POST');
    if (user.uid !== this.profile.target.accountId || user.idcardhash !== this.profile.selfHash ||
        user.idcardauthstatus !== 200) throw Error('本人实名会话不匹配或已失效，请在微信登录后重新导入HAR');
    return { identity: '市民' };
  }
  async prepare() {
    const p = await this.client.request('wtt/sport/project/info', { id: this.profile.target.sportId });
    if (p.id !== this.profile.target.sportId || p.extid !== this.profile.target.venueId ||
        p.extname !== (this.profile.venueName ?? '深圳大学城体育中心') || p.sporttype !== 'tennis' ||
        p.ruleconfig?.slicesaletime !== (this.profile.releaseAt ?? '22:00') || !String(p.paytypes).split(',').includes('2')) {
      throw Error('项目或放号规则已变化，请重新核对');
    }
    this.project = p;
    const players = await this.client.request('wtt/user/playerstore/list', { page: 1, pagesize: 999 }, 'POST');
    this.players = this.profile.playerIds.map(id => players.list?.find(p => p.id === id && p.status === 200));
    if (this.players.some(p => !p) || !this.players.some(p => p.idcardhash === this.profile.selfHash)) {
      throw Error('配置的实际参与人已失效或不包含本人');
    }
    await this.assertNoPending();
  }
  async assertNoPending() {
    const pending = await this.client.request('wtt/sport/order/list', { page: 1, pagesize: 1, status: 50 }, 'POST');
    if (!Array.isArray(pending.list) || !Number.isFinite(pending.count)) throw Error('待付款订单查询结构变化');
    if (pending.count > 0 || pending.list.length) throw Error('已有待付款订单，请先到官方订单页处理；不重复锁场');
  }
  async listSlots({ date }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('无效预约日期');
    const data = await this.client.request('wtt/sport/slice/list', {
      scene: '11', slicedate: date, projectid: this.profile.target.sportId, paytype: '2'
    });
    this.slots = data; this.date = date;
    return normalizeSlots(data, date);
  }
  async preflight(selected) {
    this.prepared = null;
    if (!this.project || this.date !== selected.date) throw Error('未准备当前日期场次');
    const normalized = normalizeSlots(this.slots, selected.date);
    const rows = selected.slotIds.map(id => this.slots.slicelist.find(s => s.id === id));
    if (!rows.length || new Set(selected.slotIds).size !== selected.slotIds.length ||
        rows.some(s => !s || !normalized.find(n => n.id === s.id)?.available)) {
      throw Error('选择的场地已不可用');
    }
    const ordered = [...rows].sort((a,b) => a.starttime.localeCompare(b.starttime));
    if(!samePlan({segments:ordered.map(s=>({courtId:s.placeid,start:s.starttime,end:s.endtime}))},selected))throw Error('场地与选择方案不匹配');
    const duration = Number(selected.end.slice(0, 2)) * 60 + Number(selected.end.slice(3)) -
      (Number(selected.start.slice(0, 2)) * 60 + Number(selected.start.slice(3)));
    const rules = this.project.ruleconfig ?? {};
    if (ordered[0].starttime !== selected.start || ordered.at(-1).endtime !== selected.end ||
        duration < (rules.payminbuytime ?? 60) || duration > (rules.paymaxbuytime ?? 120) ||
        ordered.some((s,i) => i && ordered[i-1].endtime !== s.starttime)) throw Error('必须选择同一场地的连续预约时段');
    if (rows.some(s => !Number.isFinite(s.finalunitpricey) || s.finalunitpricey <= 0)) throw Error('价格无效，不能创建待付款订单');
    const totalprice = rows.reduce((sum,s) => sum + Math.round(s.finalunitpricey * 100), 0);
    const body = { projectid: this.profile.target.sportId, slicedate: selected.date, totalprice, payprice: totalprice,
      paytype: 2, slicelist: rows.map(s => ({ buynum: 1, sliceid: s.id })),
      playerids: this.profile.playerIds.join(',') };
    // No fabricated location or participant. Server decides eligibility for the user's flow.
    if (this.profile.location) body.location = this.profile.location;
    await this.assertNoPending();
    const quote = await this.client.request('wtt/sport/order/check', {
      scene: '11', payscene: 'PS_WX_MP', tradetype: 'JSAPI', ...body
    }, 'POST');
    if (quote.link || quote.popmsg) throw Error('平台要求额外页面确认，请在官方小程序处理后重试');
    if (quote.totalprice !== totalprice || quote.payprice !== totalprice) throw Error('服务器价格与场次价格不一致，停止下单');
    const payee = quote.payeelist?.find(p => p.payeeconfigid === this.profile.payeeconfigid);
    if (!payee || !Number.isFinite(payee.payeetype)) throw Error('原预约流程的收款方式不可用，停止下单');
    this.prepared = { key: JSON.stringify(selected), at: Date.now(), body: {
      ...body, extype: this.profile.extype, payeeconfigid: payee.payeeconfigid, payeetype: payee.payeetype
    } };
    return { totalYuan: totalprice / 100 };
  }
  async hold(selected) {
    const ready = this.prepared; this.prepared = null;
    if (!ready || ready.key !== JSON.stringify(selected) || Date.now() - ready.at > 10000) throw Error('提交前校验已失效');
    const result = await this.client.request('wtt/sport/order/add', {
      appid: this.session.appid, channel: this.session.appid, payscene: 'PS_WX_MP', tradetype: 'JSAPI', ...ready.body
    }, 'POST');
    if (!result?.id) throw Error('创建响应缺少订单号');
    return this.getOrder(result.id);
  }
  async getOrder(id) {
    const startedAt = Date.now();
    const order = await this.client.request('wtt/sport/order/info', { id }, 'POST');
    if (order.id !== id) throw Error('返回订单号不匹配');
    return normalizeOrder(order, this.profile, this.project, startedAt);
  }
  async applyPayment(hold) {
    // Corresponds to order/detail + reserve/pay in the captured client.
    // Preparing a JSAPI payment does not send it to the phone or complete payment.
    const current = await this.getOrder(hold.orderId);
    if (current.status !== 'HELD' || current.date !== hold.date || !samePlan(current,hold) ||
        current.start !== hold.start || current.end !== hold.end || Date.parse(current.expiresAt) <= Date.now()) {
      throw Error('订单已失效或发生变化，停止申请支付');
    }
    const payment = await this.client.request('wtt/sport/order/payapply', {
      id: hold.orderId, payeeconfigid: this.profile.payeeconfigid,
      // This application selects no WeChat discount coupons; the captured client uses an empty tag in that case.
      prepaydata: { goodstag: '' }
    }, 'POST');
    const c = payment?.credential;
    if ((payment?.payeetype ?? 10) !== 10 || !c || !/^prepay_id=\S+$/.test(c.package) ||
        !/^\d+$/.test(String(c.timestamp)) || ![c.noncestr, c.signtype, c.sign].every(v => typeof v === 'string' && v.length > 0)) {
      throw Error('支付响应格式未匹配微信小程序收银台，停止后续操作');
    }
    return { orderId: hold.orderId, status: 'CREDENTIAL_READY', phoneSent: false,
      requestPayment: { timeStamp: String(c.timestamp), nonceStr: c.noncestr, package: c.package, signType: c.signtype, paySign: c.sign } };
  }
  async openPayment() { return { opened: false }; }
}
