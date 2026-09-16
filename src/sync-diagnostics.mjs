import {createConnection} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function portReady(port=8899){
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port});
    const done=value=>{socket.destroy();resolve(value);};
    socket.setTimeout(800);socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.once('timeout',()=>done(false));
  });
}
export function proxySummary(text){
  const enabled=/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text);
  const server=text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim()??'';
  const pac=!!text.match(/AutoConfigURL\s+REG_SZ\s+\S+/i);
  const matches=server==='127.0.0.1:8899'||server==='localhost:8899'||/(?:^|;)https=(?:127\.0\.0\.1|localhost):8899(?:;|$)/.test(server);
  return {enabled,server,pac,matches:enabled&&matches&&!pac};
}
let cached,at=0,inflight;
export async function syncDiagnostics(){
  if(cached&&Date.now()-at<5000)return cached;
  if(inflight)return inflight;
  inflight=(async()=>{
    const listening=await portReady();let proxy;
    try{const {stdout}=await exec('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{windowsHide:true,timeout:3000,maxBuffer:65536});proxy=proxySummary(stdout);}catch{proxy={unknown:true};}
    const hint=!listening?'同步助手未运行：请启动 start-session-sync.cmd。':proxy.unknown?'无法读取系统代理，请确认指向127.0.0.1:8899。':!proxy.matches?`系统代理未指向同步助手（当前：${proxy.enabled?proxy.server||'未设置':'关闭'}）。若使用Clash，请关闭它的系统代理开关后设置8899。`:'代理端口和系统设置已就绪；等待官方小程序登录请求。';
    cached={listening,proxy,hint};at=Date.now();return cached;
  })();
  try{return await inflight;}finally{inflight=null;}
}
