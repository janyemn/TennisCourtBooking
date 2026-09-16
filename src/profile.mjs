import { readFile, stat } from 'node:fs/promises';

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function field(value, path) {
  if (path === '') return value;
  if (typeof path !== 'string') throw Error('缺少响应字段映射');
  for (const key of path.split('.')) {
    if (forbidden.has(key) || value == null || !Object.hasOwn(value, key)) throw Error(`响应字段缺失：${path}`);
    value = value[key];
  }
  return value;
}
export function render(value, context) {
  if (Array.isArray(value)) return value.map(v => render(v, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, context)]));
  if (typeof value !== 'string') return value;
  const whole = value.match(/^\{\{([a-zA-Z0-9_.]+)\}\}$/);
  if (whole) return field(context, whole[1]);
  return value.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, path) => {
    const result = field(context, path);
    if (result !== null && typeof result === 'object') throw Error('数组或对象必须使用完整占位符');
    return String(result);
  });
}
export function allowedUrl(value, origins) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !origins.includes(url.origin) || url.hostname.endsWith('.invalid')) throw Error('URL不在已核实的HTTPS来源范围内');
  return url;
}
export async function loadJson(path) {
  if ((await stat(path)).size > 50 * 1024 * 1024) throw Error('文件超过50MB，请先只导出预约相关网络记录');
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

export function validateProfile(p) {
  if (p.version !== 1 || p.verified !== true) throw Error('接口配置尚未核实；请先按真实网络记录配置，不能使用示例下单。');
  if (p.releaseAt !== undefined && (typeof p.releaseAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.releaseAt))) throw Error('放号时间必须为北京时间HH:mm');
  if (!Array.isArray(p.origins) || !p.origins.length) throw Error('缺少请求来源白名单');
  if (!p.target?.venueId || !p.target?.sportId || !p.target?.accountId) throw Error('缺少场馆、项目或本人账号标识');
  if (p.provider === 'nswtt') {
    if (p.identity !== '市民' || p.releaseAt !== '22:00' || p.extype !== 41 ||
        !p.selfHash || !p.payeeconfigid || !Array.isArray(p.playerIds) || !p.playerIds.length ||
        p.playerIds.some(id => typeof id !== 'string' || !id || id.includes(',')) ||
        new Set(p.playerIds).size !== p.playerIds.length) throw Error('市民预约配置不完整');
    return p;
  }
  for (const name of ['session', 'slots', 'hold', 'order']) {
    const op = p.operations?.[name];
    if (!op || !['GET', 'POST'].includes(op.method) || !op.evidence?.trim() || /REPLACE/.test(op.evidence)) throw Error(`缺少已核实的${name}请求`);
    allowedUrl(op.url, p.origins);
    if (!['none', 'json', 'form'].includes(op.encoding)) throw Error(`不支持的${name}请求编码`);
    if (op.method === 'GET' && op.encoding !== 'none') throw Error('GET请求不能有请求体');
    if (!Array.isArray(op.assertions) || !op.assertions.length) throw Error(`缺少${name}响应成功条件`);
  }
  for (const name of ['session', 'slots', 'order']) {
    if (p.operations[name].readOnly !== true) throw Error(`${name}必须核实为只读请求`);
  }
  if (p.operations.hold.createsUnpaidOrderOnly !== true) throw Error('必须确认提交接口只创建待支付订单');
  const holdTemplate = JSON.stringify([p.operations.hold.query, p.operations.hold.body]);
  for (const variable of ['date', 'courtId', 'slotIds']) {
    if (!holdTemplate.includes(`{{${variable}}}`) && !holdTemplate.includes(`{{${variable}Csv}}`)) throw Error(`下单模板缺少动态${variable}`);
  }
  const slotTemplate = JSON.stringify([p.operations.slots.query, p.operations.slots.body]);
  if (!slotTemplate.includes('{{date}}')) throw Error('场次查询必须使用目标日期');
  const orderTemplate = JSON.stringify([p.operations.order.query, p.operations.order.body]);
  if (!orderTemplate.includes('{{orderId}}')) throw Error('订单查询必须使用创建返回的订单号');
  const required = {
    session: ['accountId', 'identity', 'studentValue'],
    slots: ['rows', 'id', 'courtId', 'date', 'venueId', 'sportId', 'start', 'end', 'available', 'availableValue'],
    hold: ['orderId'],
    order: ['orderId', 'accountId', 'identity', 'studentValue', 'venueId', 'sportId', 'courtId', 'date', 'start', 'end', 'status', 'heldValue', 'expiresAt', 'expiresFormat']
  };
  for (const [name, keys] of Object.entries(required)) {
    for (const key of keys) if (p.maps?.[name]?.[key] === undefined) throw Error(`缺少${name}.${key}映射`);
  }
  if (!['iso', 'unixSeconds', 'unixMilliseconds'].includes(p.maps.order.expiresFormat)) throw Error('未知订单到期时间格式');
  for (const key of ['loginUrl', 'paymentUrl']) if (p[key]) allowedUrl(p[key], p.origins);
  return p;
}
