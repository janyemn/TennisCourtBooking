import { mkdir, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bookingDate, nextRelease, reserve, Journal } from './engine.mjs';
import { loadJson, validateProfile } from './profile.mjs';
import { HttpAdapter } from './http-adapter.mjs';
import { NswttAdapter } from './nswtt-adapter.mjs';
import { persistSessionRotation } from './session-store.mjs';
import { harCommand } from './har.mjs';
import { ask, openHttps, waitUntil } from './terminal.mjs';

const help = `网球预约助手：本地HTTP请求版（需要已核实的接口配置及本人会话）
  node src/main.mjs validate
  node src/main.mjs check         只检查登录和次日场次，不下单
  node src/main.mjs run           下一个放号时间尝试预约次日19–21点
  node src/main.mjs run --daily   进程保持运行，每日预约；Ctrl+C停止
  node src/refresh-session.mjs HAR路径  更新已配置的南山文体通本人会话
默认配置：.local/profile.json、.local/session.json
可使用 --profile 路径、--session 路径；示例在 config/profile.example.json。
当前专用适配器使用市民流程；密码由用户在官方微信输入。`;

export async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') { console.log(help); return; }
  if (command === 'har') return harCommand(rest);
  if (!['validate', 'check', 'run'].includes(command)) throw Error('未知命令，运行 npm start -- help 查看用法');
  const options = { profile: '.local/profile.json', session: '.local/session.json', daily: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--daily' && command === 'run') options.daily = true;
    else if (['--profile', '--session'].includes(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--')) options[rest[i].slice(2)] = rest[++i];
    else throw Error('未知或不完整的参数');
  }
  const profile = validateProfile(await loadJson(options.profile));
  if (command === 'validate') { console.log('配置结构检查通过；这不代表真实接口已经可用。'); return; }
  const makeAdapter = async () => new (profile.provider === 'nswtt' ? NswttAdapter : HttpAdapter)(profile, await loadJson(options.session), { navigate: openHttps, onSessionUpdate: persistSessionRotation(resolve(options.session)) });
  if (command === 'check') {
    const adapter = await makeAdapter();
    await adapter.waitForLogin();
    if (profile.provider === 'nswtt') await adapter.prepare();
    const date = bookingDate(new Date());
    const slots = await adapter.listSlots({ date });
    console.log(`${profile.identity ?? '师生'}身份验证通过，${date}读取到${slots.length}个匹配场次，其中${slots.filter(s => s.available).length}个可选；未提交预约。`);
    return;
  }
  await mkdir('.local', { recursive: true });
  let lock;
  const lockPath = resolve('.local/booking.lock');
  try {
    lock = await open(lockPath, 'wx');
    await lock.writeFile(String(process.pid));
    const accountKey = createHash('sha256').update(JSON.stringify([profile.origins.slice().sort(), String(profile.target.accountId)])).digest('hex').slice(0, 20);
    do {
      const releaseAt = profile.releaseAt ?? '22:00';
      const release = nextRelease(new Date(), releaseAt);
      const date = bookingDate(release);
      const journal = new Journal(resolve('.local/orders', accountKey, `${date}.json`));
      if (await journal.read()) {
        console.log(`${date}已有提交记录，跳过；如需核实请查看官方订单。`);
        if (!options.daily) return;
        await waitUntil(new Date(release.getTime() + 31000));
        continue;
      }
      const adapter = await makeAdapter();
      await adapter.waitForLogin();
      const releaseDay = new Date(release.getTime() + 8 * 3600000).toISOString().slice(0, 10);
      console.log(`已安排北京时间 ${releaseDay} ${releaseAt}，预约 ${date} 19:00–21:00。请保持电脑联网、程序运行且不休眠。`);
      await waitUntil(new Date(release.getTime() - 120000));
      // Reload a refreshed local session shortly before release.
      const activeAdapter = await makeAdapter();
      await reserve({ adapter: activeAdapter, journal, release, waitUntil, identity: profile.identity ?? '师生',
        askPayment: async timeout => {
          process.stdout.write('\x07');
          return await ask('已锁场。最多等待3分钟：输入“去支付”打开已配置的官方订单页面，回车结束等待：', timeout) === '去支付';
        }
      });
      if (options.daily) await waitUntil(new Date(release.getTime() + 31000));
    } while (options.daily);
  } finally { if (lock) { await lock.close(); await unlink(lockPath); } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    if (error.code === 'ENOENT') console.error('缺少本地配置或会话文件；请先阅读 README.md 完成接入。');
    else if (error.code === 'EEXIST') console.error('运行锁或会话文件已存在；请先核实正在运行的任务及官方订单。');
    else if (error instanceof SyntaxError) console.error('配置、HAR或日志JSON无效；请在本地检查文件。');
    else console.error(error.message);
    process.exitCode = 1;
  });
}
