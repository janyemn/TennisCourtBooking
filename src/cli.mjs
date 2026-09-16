import { createInterface } from 'node:readline';
import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reserve, Journal, bookingDate } from './engine.mjs';

function prompt(message, timeoutMs = 300000) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    let timer;
    let settled = false;
    const finish = answer => {
      if (settled) return;
      settled = true; clearTimeout(timer); rl.close(); resolve(answer);
    };
    timer = setTimeout(() => finish(''), timeoutMs);
    rl.on('close', () => finish(''));
    rl.question(message, finish);
  });
}
if (!process.argv.includes('--demo')) {
  console.error('真实设备适配器尚未接入。请使用 npm run demo 演示流程。');
  process.exitCode = 1;
} else {
  console.log('【模拟演示】不会打开微信、预约真实场地或付款。');
  const root = resolve('.local', 'demo');
  await mkdir(root, { recursive: true });
  const lockPath = resolve(root, 'running.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
    const release = new Date(Date.now() + 30000);
    let order;
    const adapter = {
      async openLogin() { console.log('实际版本在此打开官方师生登录入口。'); },
      async waitForLogin() {
        if (await prompt('输入“模拟登录”继续（不要输入账号密码）：') !== '模拟登录') throw new Error('演示取消');
        return { identity: '师生' };
      },
      async prepare(request) { console.log(`演示目标：${request.date} 19:00–21:00，同一场地。`); },
      async listSlots() { return [
        { id: 'demo-19', courtId: '模拟1号场', start: '19:00', end: '20:00', available: true },
        { id: 'demo-20', courtId: '模拟1号场', start: '20:00', end: '21:00', available: true }
      ]; },
      async hold(selection) {
        order = { ...selection, status: 'HELD', orderId: 'DEMO-' + Date.now(),
          expiresAt: new Date(Date.now() + 300000).toISOString() };
        return order;
      },
      async getOrder() { return order; },
      async openPayment() { console.log('【模拟】打开官方付款页。'); }
    };
    await reserve({ adapter, release,
      journal: new Journal(resolve(root, `${bookingDate(release)}-${Date.now()}.json`)),
      waitUntil: async date => {
        while (Date.now() < date.getTime()) await new Promise(r => setTimeout(r, Math.min(500, date.getTime() - Date.now())));
      },
      askPayment: async timeout => await prompt('3分钟内输入“去支付”模拟打开付款页；直接回车则结束：', timeout) === '去支付'
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { if (lock) { await lock.close(); await unlink(lockPath); } }
}
