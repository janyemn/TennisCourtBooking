import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

export function ask(message, timeoutMs = 180000) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    let done = false;
    let timer;
    const finish = result => {
      if (done) return;
      done = true; clearTimeout(timer); rl.close(); resolve(result);
    };
    timer = setTimeout(() => finish(''), Math.max(1, timeoutMs));
    rl.on('close', () => finish(''));
    rl.question(message, finish);
  });
}
export async function waitUntil(date) {
  while (Date.now() < date.getTime()) {
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, date.getTime() - Date.now())));
  }
}
export async function openHttps(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || /[\s"<>]/.test(url)) throw Error('拒绝非HTTPS页面链接');
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve({ opened: false }));
    child.once('exit', code => resolve({ opened: code === 0 }));
  });
}
